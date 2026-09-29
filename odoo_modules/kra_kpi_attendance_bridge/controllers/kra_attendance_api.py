from datetime import datetime, timedelta, date as _date
import logging

import pytz

from odoo import http, fields
from odoo.http import request

from odoo.addons.kra_kpi_module.controllers.kra_api import KraKpiAPI
from odoo.addons.hr_attendance_369.models.attendance_day_status import STATUS_LABELS

_logger = logging.getLogger(__name__)

# Statuses the app can receive. The six from hr.attendance.day.status, plus
# three of our own for days that have no row yet:
#   not_checked_in -- today, nobody has arrived (and it is a working day)
#   upcoming       -- a future day in the week strip
#   none           -- a past working day with no record at all (before the
#                     absent cron was configured, or before the module existed).
#                     Reported as "No record", never guessed as Absent.
EXTRA_LABELS = {
    'not_checked_in': 'Not checked in',
    'upcoming': 'Upcoming',
    'none': 'No record',
}


def _label(status):
    return STATUS_LABELS.get(status) or EXTRA_LABELS.get(status) or (status or '').replace('_', ' ').title()


def _fmt_hours(hours):
    """8.55 -> '8h 33m'; 0 -> '0m'."""
    total = int(round(max(0.0, float(hours or 0.0)) * 60))
    h, m = divmod(total, 60)
    if h and m:
        return '%dh %02dm' % (h, m)
    if h:
        return '%dh' % h
    return '%dm' % m


def _fmt_time(dt, tz):
    """Naive UTC -> '10:12 AM' in the office timezone."""
    if not dt:
        return ''
    local = pytz.utc.localize(dt).astimezone(tz)
    return local.strftime('%I:%M %p').lstrip('0')


def _fmt_late(minutes):
    m = int(minutes or 0)
    if m <= 0:
        return ''
    h, r = divmod(m, 60)
    return ('%dh %02dm' % (h, r)) if h else ('%d min' % r)


def _is_admin(user):
    return request.env['kra.kpi'].sudo()._user_is_kpi_admin(user)


def _is_hr(user):
    return user.has_group('hr.group_hr_user') or user.has_group('hr.group_hr_manager')


def _is_client(user):
    return user.has_group('kra_kpi_module.group_kra_client') and not _is_admin(user)


def _employee_of(user):
    """The hr.employee behind a res.users -- same lookup the bridge's
    check-in uses. sudo: hr.employee has no base.group_user ACL in Odoo 19."""
    return request.env['hr.employee'].sudo().search(
        [('user_id', '=', user.id)], limit=1)


class _DayBuilder:
    """Builds one app row per (employee, date).

    One instance per request: it caches the per-employee config and timezone
    and does ONE search each for day-status rows and attendances over the
    whole range, so a 90-day history is two queries, not 180.
    """

    def __init__(self):
        self.Config = request.env['hr.attendance.late.config'].sudo()
        self.DayStatus = request.env['hr.attendance.day.status'].sudo()
        self.Attendance = request.env['hr.attendance'].sudo()
        self.now = fields.Datetime.now()
        self._cfg = {}
        self._tz = {}

    # -- per-employee config ------------------------------------------------ #
    def cfg(self, emp):
        if emp.id not in self._cfg:
            self._cfg[emp.id] = self.Config.get_config_for_employee(emp.id)
        return self._cfg[emp.id]

    def tz(self, emp):
        if emp.id not in self._tz:
            name = self.cfg(emp).get('timezone') or emp.tz or 'UTC'
            try:
                self._tz[emp.id] = pytz.timezone(name)
            except Exception:
                self._tz[emp.id] = pytz.utc
        return self._tz[emp.id]

    def today(self, emp):
        """Today's DATE on the office clock, not the server's."""
        return pytz.utc.localize(self.now).astimezone(self.tz(emp)).date()

    def is_working_day(self, emp, day):
        try:
            return bool(self.Config.is_working_day(day, emp.id))
        except Exception:
            return day.weekday() < 6

    # -- bulk loads ----------------------------------------------------------- #
    def load(self, employees, d_from, d_to):
        """Day-status rows and attendances for these employees over
        [d_from, d_to], keyed by (employee_id, date). Attendance is keyed on
        its OFFICE-local date and the earliest check-in of the day wins --
        the arrival is what grades the day."""
        emp_ids = employees.ids
        self.ds_by_key = {}
        for ds in self.DayStatus.search([
                ('employee_id', 'in', emp_ids),
                ('date', '>=', d_from), ('date', '<=', d_to)]):
            self.ds_by_key[(ds.employee_id.id, ds.date)] = ds

        # Widen the UTC window by a day either side; the office-local date is
        # decided per record below, so the slop only costs a few rows.
        start = datetime.combine(d_from - timedelta(days=1), datetime.min.time())
        end = datetime.combine(d_to + timedelta(days=2), datetime.min.time())
        self.att_by_key = {}        # earliest check-in: the anchor that grades the day
        self.att_last_by_key = {}   # latest record: where the check-out comes from
        self.open_by_key = {}       # the one still open, if any
        self.worked_by_key = {}     # closed records' worked_hours, summed
        for att in self.Attendance.search([
                ('employee_id', 'in', emp_ids),
                ('check_in', '>=', start), ('check_in', '<', end)],
                order='check_in asc'):
            emp = att.employee_id
            local_day = pytz.utc.localize(att.check_in).astimezone(self.tz(emp)).date()
            if local_day < d_from or local_day > d_to:
                continue
            key = (emp.id, local_day)
            self.att_by_key.setdefault(key, att)
            self.att_last_by_key[key] = att
            if att.check_out:
                self.worked_by_key[key] = self.worked_by_key.get(key, 0.0) + float(att.worked_hours or 0.0)
            else:
                self.open_by_key[key] = att

    # -- one row ---------------------------------------------------------------- #
    def row(self, emp, day):
        cfg = self.cfg(emp)
        tz = self.tz(emp)
        today = self.today(emp)
        key = (emp.id, day)
        ds = self.ds_by_key.get(key)
        att = self.att_by_key.get(key)
        last = self.att_last_by_key.get(key)

        if ds and ds.attendance_id and ds.attendance_id.check_in:
            att = ds.attendance_id

        status = None
        status_display = ''
        deduction = 0.0
        if ds:
            status = ds.status
            status_display = ds.status_display or ''
            deduction = ds.deduction_amount or 0.0
        elif att:
            # The cron has not written today's row yet (it runs every 30 min,
            # and only once the office passes late_until_hour). Grade the
            # attendance the same way the row would, on a throwaway record.
            try:
                tmp = self.DayStatus.new({
                    'employee_id': emp.id, 'date': day, 'attendance_id': att.id})
                status = tmp._grade_attendance(att, cfg)
                tmp.status = status
                status_display = tmp._build_status_display(att, cfg)
            except Exception:
                _logger.exception('[kra-attendance] grading fallback failed')
                status = 'late' if att.is_late else 'present'
                status_display = _label(status)
        elif day > today:
            status = 'upcoming'
        elif not self.is_working_day(emp, day):
            status = 'day_off'
        elif day == today:
            status = 'not_checked_in'
        else:
            status = 'none'
        if not status_display:
            status_display = _label(status)

        # Check-out comes from the LAST attendance of the day (a reopened day
        # extends the same record, but a second check-in makes a new one).
        # Worked hours are the day's closed records added up, plus the live
        # span of one still open -- so the card ticks while they are working.
        check_out = last.check_out if last else False
        is_open = bool(att and att.check_in and not check_out)
        worked = self.worked_by_key.get(key, 0.0)
        if is_open:
            open_att = self.open_by_key.get(key) or att
            worked += max(0.0, (self.now - open_att.check_in).total_seconds() / 3600.0)

        return {
            'date': day.isoformat(),
            'day_number': day.day,
            'weekday': day.strftime('%a').upper(),
            'label': day.strftime('%a %d %b'),
            'status': status,
            'status_label': _label(status),
            'status_display': status_display,
            'check_in': fields.Datetime.to_string(att.check_in) if att and att.check_in else '',
            'check_out': fields.Datetime.to_string(check_out) if check_out else '',
            'check_in_office_time': _fmt_time(att.check_in, tz) if att and att.check_in else '',
            'check_out_office_time': _fmt_time(check_out, tz) if check_out else '',
            'worked_hours': round(worked, 2),
            'worked_display': _fmt_hours(worked) if (att and att.check_in) else '',
            'is_late': bool(att and att.is_late),
            'late_minutes': int(att.late_minutes or 0) if att else 0,
            'late_minutes_display': _fmt_late(att.late_minutes) if att and att.is_late else '',
            'late_reason': (att.late_reason or '') if att else '',
            'is_wfh': bool(att and att.is_wfh),
            'work_location': (att.work_location or '') if att else '',
            'deduction_amount': round(deduction, 2),
            'from_kra': bool(att and att.kra_session_ids),
            'open': is_open,
            'is_today': day == today,
        }

    # -- aggregates --------------------------------------------------------- #
    @staticmethod
    def counts(rows):
        c = {'present': 0, 'late': 0, 'half_day': 0, 'absent': 0, 'leave': 0,
             'day_off': 0, 'not_checked_in': 0, 'none': 0, 'wfh': 0,
             'deduction_total': 0.0}
        for r in rows:
            st = r['status']
            if st in c:
                c[st] += 1
            if r['is_wfh']:
                c['wfh'] += 1
            c['deduction_total'] += r['deduction_amount'] or 0.0
        c['deduction_total'] = round(c['deduction_total'], 2)
        return c


# ---------------------------------------------------------------------- #
# Configuration screen: the switch                                        #
# ---------------------------------------------------------------------- #
class KraKpiAPIAttendanceConfig(KraKpiAPI):
    """Adds the attendance switch to the app's Configuration screen.

    Same mechanism as kra_role_bridge.py: subclass the KRA controller so its
    /kpi_config/get answer gains two keys, without touching kra_kpi_module.
    `attendance_available` is what tells the app the bridge is installed at
    all -- a server without it simply never sends the key, and the app hides
    the whole card.
    """

    @http.route('/kpi_config/get', type='json', auth='user', methods=['POST'], csrf=False)
    def kpi_config_get(self, **params):
        res = super().kpi_config_get(**params)
        if isinstance(res, dict):
            res['attendance_available'] = True
            res['attendance_in_app'] = bool(request.env.company.kra_attendance_in_app)
        return res

    @http.route('/kpi_config/set_attendance_in_app', type='json', auth='user',
                methods=['POST'], csrf=False)
    def kpi_config_set_attendance_in_app(self, **params):
        if not self._is_kra_admin(request.env.user):
            return {'status': False, 'message': 'Not authorized'}
        c = request.env.company.sudo()
        c.kra_attendance_in_app = bool(params.get('enabled'))
        return {'status': True, 'attendance_in_app': c.kra_attendance_in_app}


# ---------------------------------------------------------------------- #
# The Attendance page                                                     #
# ---------------------------------------------------------------------- #
class KraAttendanceAPI(http.Controller):
    """What the floating Attendance button opens.

    Three reads, no writes -- checking in and out stays with Start/End
    Workday. `/mine` is hard-scoped to request.env.user, the same rule as
    /kpi_reports/my_workday; `/team` is admin/HR only.
    """

    def _enabled_for(self, user):
        if _is_client(user):
            return False
        return bool(request.env.company.kra_attendance_in_app)

    def _can_view_team(self, user):
        return _is_admin(user) or _is_hr(user)

    @http.route('/kpi_attendance/status', type='json', auth='user', methods=['POST'], csrf=False)
    def attendance_status(self, **params):
        """Cheap: Home calls this once to decide whether to draw the bubble,
        and which colour its dot is."""
        user = request.env.user
        enabled = self._enabled_for(user)
        out = {'status': True, 'enabled': enabled,
               'can_view_team': bool(enabled and self._can_view_team(user)),
               'has_employee': False, 'today': None}
        if not enabled:
            return out
        emp = _employee_of(user)
        if not emp:
            return out
        try:
            b = _DayBuilder()
            today = b.today(emp)
            b.load(emp, today, today)
            out['has_employee'] = True
            out['today'] = b.row(emp, today)
        except Exception as e:
            _logger.exception('[kra-attendance] status failed')
            out['message'] = str(e)
        return out

    @http.route('/kpi_attendance/mine', type='json', auth='user', methods=['POST'], csrf=False)
    def attendance_mine(self, **params):
        """The caller's own attendance: today, this week, this month's counts
        and a history of `days` days (default 30). Never takes a user id."""
        user = request.env.user
        if not self._enabled_for(user):
            return {'status': False, 'message': 'Attendance is not enabled in the app.'}
        emp = _employee_of(user)
        if not emp:
            return {'status': True, 'has_employee': False, 'enabled': True,
                    'message': 'Your login is not linked to an HR employee yet. '
                               'Ask your admin to link it in Employees.'}
        try:
            days_back = max(1, min(366, int(params.get('days') or 30)))
        except (TypeError, ValueError):
            days_back = 30
        try:
            b = _DayBuilder()
            today = b.today(emp)
            week_start = today - timedelta(days=today.weekday())      # Monday
            week_end = week_start + timedelta(days=6)
            month_start = today.replace(day=1)
            hist_start = today - timedelta(days=days_back - 1)
            d_from = min(hist_start, week_start, month_start)
            b.load(emp, d_from, week_end)

            history = [b.row(emp, hist_start + timedelta(days=i))
                       for i in range((today - hist_start).days + 1)]
            history.reverse()                                          # newest first
            week = [b.row(emp, week_start + timedelta(days=i)) for i in range(7)]
            month_rows = [b.row(emp, month_start + timedelta(days=i))
                          for i in range((today - month_start).days + 1)]
            month = b.counts(month_rows)
            month['label'] = today.strftime('%B')
            month['year'] = today.year
            return {
                'status': True, 'enabled': True, 'has_employee': True,
                'employee_name': emp.name or user.name or '',
                'office_tz': str(b.tz(emp)),
                'today': b.row(emp, today),
                'week': week,
                'month': month,
                'days': history,
                'days_back': days_back,
                'can_view_team': self._can_view_team(user),
            }
        except Exception as e:
            _logger.exception('[kra-attendance] mine failed')
            return {'status': False, 'message': str(e)}

    @http.route('/kpi_attendance/team', type='json', auth='user', methods=['POST'], csrf=False)
    def attendance_team(self, **params):
        """Everyone on the KRA roster for one day. Admin / HR only.

        The roster is the developer group minus admins, the same set Live
        Tracking lists, plus the admins themselves in a second block -- an
        admin's own day is graded too.
        """
        user = request.env.user
        if not self._enabled_for(user) or not self._can_view_team(user):
            return {'status': False, 'message': 'Not authorized'}
        try:
            day = fields.Date.from_string(params.get('date')) if params.get('date') else None
        except Exception:
            day = None
        try:
            Users = request.env['res.users'].sudo()
            grp_dev = request.env.ref('kra_kpi_module.group_kra_developer', raise_if_not_found=False)
            roster = grp_dev.sudo().user_ids if grp_dev else Users.browse()
            roster = roster.filtered(lambda u: u.active and not u.share
                                     and not u.has_group('base.group_system')
                                     and not u.has_group('kra_kpi_module.group_kra_client'))
            # Admins/owners hold the developer group implicitly; keep them,
            # just sort them after the developers.
            def _rank(u):
                return (1 if _is_admin(u) else 0, (u.name or '').lower())
            roster = roster.sorted(key=_rank)

            Employee = request.env['hr.employee'].sudo()
            emp_by_uid = {}
            for emp in Employee.search([('user_id', 'in', roster.ids)]):
                emp_by_uid.setdefault(emp.user_id.id, emp)
            employees = Employee.browse([e.id for e in emp_by_uid.values()])

            b = _DayBuilder()
            if day is None:
                # Office-today of the first employee (they share a company);
                # fall back to the server date when nobody is linked.
                day = b.today(employees[0]) if employees else fields.Date.context_today(user)
            if employees:
                b.load(employees, day, day)

            rows, missing = [], []
            for u in roster:
                emp = emp_by_uid.get(u.id)
                if not emp:
                    missing.append({'user_id': u.id, 'name': u.name or u.login or ''})
                    continue
                r = b.row(emp, day)
                r.update({'user_id': u.id, 'name': u.name or emp.name or '',
                          'employee_id': emp.id, 'has_employee': True,
                          'is_admin': _is_admin(u)})
                rows.append(r)

            counts = b.counts(rows)
            return {
                'status': True,
                'date': day.isoformat(),
                'label': day.strftime('%a, %d %b'),
                'is_today': any(r.get('is_today') for r in rows) if rows else False,
                'counts': counts,
                'rows': rows,
                'not_in_hr': missing,
            }
        except Exception as e:
            _logger.exception('[kra-attendance] team failed')
            return {'status': False, 'message': str(e)}
