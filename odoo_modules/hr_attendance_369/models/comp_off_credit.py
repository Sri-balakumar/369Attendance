from odoo import models, fields, api, exceptions, _
from odoo.tools import float_compare
from datetime import datetime, timedelta, date as dt_date
import logging
import pytz

from .attendance_late_config import is_weekly_off_day
from .comp_off_redemption import ACTIVE_REQUEST_STATES

_logger = logging.getLogger(__name__)

# Days are 0.5 or 1.0, so two decimals is plenty for every comparison here.
PREC = 2


class CompOffCredit(models.Model):
    """One compensatory off, earned by working a day nobody owed attendance on.

    Kept as its own ledger rather than as extra paid-leave quota, because the
    two are not the same thing and must not be spent out of one pot: paid leave
    is an allowance the company grants, a comp off is a day the employee has
    already worked and is owed back.

    A row starts life as a DECLARATION. On a weekly off or a public holiday the
    employee taps "I am working today" in the attendance app, which writes a
    row in state `declared` with no days on it. That row is what unlocks
    check-in for the day (hr.attendance._check_day_off_declared refuses a
    check-in on a day off that has no such row). When they check out,
    `_sync_for_day` sizes it -- a full day or a half, by the same hours
    threshold that grades an ordinary half day -- and moves it to `available`.
    Nothing is minted silently any more: a day off worked without a
    declaration earns nothing unless HR adds a credit by hand.

    CONSUMPTION IS BY ALLOCATION. A comp-off leave request draws on specific
    credits through hr.comp.off.redemption lines, oldest expiry first. Those
    lines are never deleted, so a credit that reads Consumed still shows which
    holiday it was and which leave spent it. A line only counts while its
    leave is pending or approved; reject or cancel the leave and the credit is
    available again.
    """

    _name = 'hr.comp.off.credit'
    _description = 'Compensatory Off Credit'
    _order = 'date_earned desc, id desc'
    _rec_name = 'display_name'

    employee_id = fields.Many2one(
        'hr.employee', string='Employee',
        required=True, index=True, ondelete='cascade',
    )
    company_id = fields.Many2one(
        related='employee_id.company_id', store=True, index=True,
    )
    date_earned = fields.Date(
        string='Date Worked', required=True, index=True,
        help='The weekly off or public holiday that was worked.',
    )
    days = fields.Float(
        string='Days Earned', default=1.0,
        help='A full day worked earns 1 day, a short day earns half. Sized by '
             'the same hours threshold that decides a half day on an ordinary '
             'working day, so the two cannot drift apart. Zero while the day '
             'is only declared and not yet worked.',
    )
    source = fields.Selection([
        ('weekly_off', 'Weekly Off'),
        ('public_holiday', 'Public Holiday'),
    ], string='Earned On', index=True)
    holiday_name = fields.Char(
        string='Holiday', compute='_compute_holiday_name',
        help='The public holiday on the day worked, when there is one.',
    )

    day_status_id = fields.Many2one(
        'hr.attendance.day.status', string='Day', ondelete='set null',
        help='The day row this credit was earned from.',
    )
    auto_created = fields.Boolean(
        string='Automatic', default=True,
        help='Declared by the employee and sized by the system from their '
             'check-out. A credit added by hand is never resized or withdrawn '
             'automatically.',
    )
    declared_at = fields.Datetime(
        string='Declared On', readonly=True,
        help='When the employee said they would work this day off, or when HR '
             'granted the credit by hand.',
    )
    declared_by = fields.Many2one(
        'res.users', string='Declared By', readonly=True,
    )
    hours_worked = fields.Float(
        string='Hours Worked', readonly=True,
        help='Hours on the clock that day when the credit was sized. Kept so '
             'a half day can always be explained.',
    )

    state = fields.Selection([
        ('declared', 'Declared'),
        ('available', 'Available'),
        ('consumed', 'Consumed'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='available', required=True, index=True,
        help='Declared: the employee said they will work this day off; '
             'nothing is earned until they check out. Available: earned and '
             'not yet fully taken. Consumed: fully taken by approved leave. '
             'The lines under Redemptions say exactly which leave took it.',
    )
    expiry_date = fields.Date(
        string='Expires', compute='_compute_expiry_date', store=True,
        readonly=False,
        help='Empty means it never expires. Set from the leave policy at the '
             'time the credit is earned.',
    )
    note = fields.Char(string='Note')
    days_lapsed = fields.Float(
        string='Days Lapsed', readonly=True,
        help='The UNSPENT part of this credit that expired. Only that part is '
             'lost: whatever had already been claimed stays counted as earned, '
             'or expiry would quietly eat a newer credit and turn leave that '
             'was already approved into unpaid leave.',
    )

    redemption_ids = fields.One2many(
        'hr.comp.off.redemption', 'credit_id', string='Redemptions',
        help='Every leave request that drew on this credit, kept for good.',
    )
    days_used = fields.Float(
        string='Days Used', compute='_compute_usage', store=True,
        help='How much of this credit pending and approved leave has taken.',
    )
    days_left = fields.Float(
        string='Days Left', compute='_compute_usage', store=True,
    )

    display_name = fields.Char(compute='_compute_display_name', store=True)

    _unique_employee_date = models.Constraint(
        'UNIQUE(employee_id, date_earned)',
        'This employee already has a compensatory off for that date.',
    )

    # States whose credit still counts as earned. An expired credit keeps the
    # part that was spent before it lapsed (days - days_lapsed); a cancelled
    # one counts for nothing; a declared one has not been earned yet.
    _EARNED_STATES = ('available', 'consumed', 'expired')

    # ------------------------------------------------------------------ #
    # Display                                                            #
    # ------------------------------------------------------------------ #
    @api.depends('employee_id', 'date_earned', 'days', 'state')
    def _compute_display_name(self):
        for rec in self:
            who = rec.employee_id.name or ''
            when = rec.date_earned.strftime('%d %b %Y') if rec.date_earned else ''
            if rec.state == 'declared':
                rec.display_name = '%s - Comp Off %s (declared)' % (who, when)
            else:
                rec.display_name = '%s - Comp Off %s (%g)' % (
                    who, when, rec.days or 0.0)

    @api.depends('date_earned', 'company_id')
    def _compute_holiday_name(self):
        Holiday = self.env['hr.public.holiday'].sudo()
        for rec in self:
            rec.holiday_name = ''
            if not rec.date_earned:
                continue
            company_id = rec.company_id.id or self.env.company.id
            holiday = Holiday.search([
                ('date', '=', rec.date_earned),
                ('company_id', '=', company_id),
            ], limit=1)
            rec.holiday_name = holiday.name or ''

    # ------------------------------------------------------------------ #
    # Policy, expiry, timezone                                           #
    # ------------------------------------------------------------------ #
    @api.model
    def _policy(self, company_id):
        """The comp-off half of the leave policy for one company."""
        return self.env['hr.leave.config'].sudo().get_config_for_company(company_id)

    @api.model
    def _office_config(self, employee):
        """Office Hours config for an employee, read with sudo.

        get_config_for_employee browses hr.employee, which an ordinary
        employee cannot read in Odoo 19 (SESSION.md, "Hard-won API facts"),
        so every internal lookup here goes through sudo. Nothing it returns
        reaches a caller except the office timezone and the working days.
        """
        return self.env['hr.attendance.late.config'].sudo().get_config_for_employee(
            employee.id)

    @api.model
    def _office_tz(self, employee, cfg=None):
        if cfg is None:
            cfg = self._office_config(employee)
        tz_name = cfg.get('timezone') or employee.sudo().tz or 'UTC'
        try:
            return pytz.timezone(tz_name)
        except Exception:
            return pytz.utc

    @api.model
    def _office_today(self, employee, cfg=None):
        """Today's date in the OFFICE timezone -- the same day the attendance
        grading and the KRA bridge use, so midnight edges agree."""
        tz = self._office_tz(employee, cfg)
        return pytz.utc.localize(fields.Datetime.now()).astimezone(tz).date()

    @api.model
    def _day_window(self, employee, day, cfg=None):
        """UTC bounds of one office-local day, as naive datetimes."""
        tz = self._office_tz(employee, cfg)
        start_local = tz.localize(datetime.combine(day, datetime.min.time()))
        start = start_local.astimezone(pytz.utc).replace(tzinfo=None)
        end = (start_local + timedelta(days=1)).astimezone(pytz.utc).replace(tzinfo=None)
        return start, end

    @api.depends('date_earned', 'company_id')
    def _compute_expiry_date(self):
        """Stamp the expiry at the moment the credit is earned.

        Stored, and deliberately not re-derived afterwards: shortening the
        policy should not retroactively kill credits people have already been
        told they hold. The cron only ever acts on the date written here.
        """
        cache = {}
        for rec in self:
            company_id = rec.company_id.id or self.env.company.id
            if company_id not in cache:
                cache[company_id] = self._policy(company_id)
            window = cache[company_id].get('comp_off_expiry_days') or 0
            if rec.date_earned and window > 0:
                rec.expiry_date = rec.date_earned + timedelta(days=window)
            else:
                rec.expiry_date = False

    # ------------------------------------------------------------------ #
    # Create                                                             #
    # ------------------------------------------------------------------ #
    @api.model_create_multi
    def create(self, vals_list):
        now = fields.Datetime.now()
        for vals in vals_list:
            # Who granted or declared it is part of the audit trail whichever
            # way the row came in -- the app's declare route, the HR form, or
            # an import.
            vals.setdefault('declared_at', now)
            vals.setdefault('declared_by', self.env.user.id)
            if vals.get('state') == 'declared':
                vals['days'] = 0.0
        return super().create(vals_list)

    # ------------------------------------------------------------------ #
    # Usage and balance                                                  #
    # ------------------------------------------------------------------ #
    def _active_usage(self, exclude_request_id=None):
        """Days of this credit held by pending or approved leave."""
        self.ensure_one()
        total = 0.0
        for line in self.sudo().redemption_ids:
            if line.leave_request_id.state not in ACTIVE_REQUEST_STATES:
                continue
            if exclude_request_id and line.leave_request_id.id == exclude_request_id:
                continue
            total += line.days or 0.0
        return total

    def _approved_usage(self):
        self.ensure_one()
        return sum(
            (line.days or 0.0) for line in self.sudo().redemption_ids
            if line.leave_request_id.state == 'approved')

    @api.depends('days', 'days_lapsed', 'state',
                 'redemption_ids.days', 'redemption_ids.request_state')
    def _compute_usage(self):
        for rec in self:
            used = rec._active_usage() if rec.id else 0.0
            rec.days_used = used
            if rec.state in ('available', 'consumed'):
                rec.days_left = max(0.0, (rec.days or 0.0) - used)
            else:
                # Declared has nothing yet; expired and cancelled have nothing
                # left to spend, whatever they held -- saying otherwise would
                # invite somebody to try.
                rec.days_left = 0.0

    def _capacity(self):
        """Days of this credit that count as earned."""
        self.ensure_one()
        if self.state not in self._EARNED_STATES:
            return 0.0
        return max(0.0, (self.days or 0.0) - (self.days_lapsed or 0.0))

    def _refresh_state(self):
        """Available <-> Consumed, from what approved leave has taken.

        Consumed means FULLY taken by APPROVED leave. A pending reservation
        holds the days (they are not available to anyone else) but does not
        consume them, so a credit with only pending lines stays Available.
        """
        for rec in self.sudo():
            if rec.state not in ('available', 'consumed'):
                continue
            days = rec.days or 0.0
            full = days > 0 and float_compare(
                rec._approved_usage(), days, precision_digits=PREC) >= 0
            if rec.state == 'available' and full:
                rec.write({'state': 'consumed'})
            elif rec.state == 'consumed' and not full:
                rec.write({'state': 'available'})

    @api.model
    def _is_comp_off_manager(self):
        user = self.env.user
        return (user.has_group('hr.group_hr_user')
                or user.has_group('hr_attendance_369.group_leave_manager')
                or user.has_group('base.group_system'))

    @api.model
    def _assert_may_read(self, employee_id):
        """Employees may only ask about themselves; HR and leave managers may
        ask about anybody. Model methods are reachable through call_kw with
        any employee id, so the check lives here, not in the routes."""
        if self.env.su or self._is_comp_off_manager():
            return
        employee = self.env['hr.employee'].sudo().browse(int(employee_id or 0))
        if not employee.exists() or employee.user_id.id != self.env.uid:
            raise exceptions.AccessError(
                _('You can only view your own compensatory off.'))

    @api.model
    def _earned_credits(self, employee_id):
        return self.sudo().search([
            ('employee_id', '=', employee_id),
            ('state', 'in', self._EARNED_STATES),
        ], order='date_earned asc, id asc')

    @api.model
    def get_comp_off_balance(self, employee_id, before_id=None,
                             ignore_policy=False, exclude_request_id=None):
        """What this employee can still take as compensatory off.

        The single balance API: the employee form, the leave request, the
        mobile app and the balance list all read this, so none of them can
        disagree about the number.

        `exclude_request_id` leaves out that request's own reservation, so a
        request can ask what it could afford without counting itself.
        `before_id` is the old name for the same thing and is kept for callers
        that still pass it.

        `ignore_policy` is for pricing leave that already exists: switching
        comp off off must stop NEW requests, not re-price approved ones as
        unpaid the next time anything recomputes them.
        """
        self._assert_may_read(employee_id)
        exclude = exclude_request_id or before_id
        employee = self.env['hr.employee'].sudo().browse(employee_id)
        company_id = (employee.company_id.id if employee.exists()
                      else self.env.company.id)
        policy = self._policy(company_id)
        enabled = bool(policy.get('comp_off_enabled'))

        if not enabled and not ignore_policy:
            return {'enabled': False, 'earned': 0.0, 'used': 0.0,
                    'balance': 0.0}

        credits = self._earned_credits(employee_id)
        earned = sum(c._capacity() for c in credits)
        used = sum(c._active_usage(exclude) for c in credits)

        return {
            'enabled': enabled,
            'earned': earned,
            'used': used,
            'balance': max(0.0, earned - used),
        }

    # ------------------------------------------------------------------ #
    # Allocation                                                         #
    # ------------------------------------------------------------------ #
    @api.model
    def _plan_allocation(self, employee_id, days, exclude_request_id=None):
        """Which credits would pay for `days` of comp-off leave.

        Returns ([(credit, take), ...], shortfall). Oldest expiry first, then
        oldest earned, so the credit closest to being lost is the one spent.
        Credits that never expire come last. Pure: nothing is written.
        """
        credits = self.sudo().search([
            ('employee_id', '=', employee_id),
            ('state', '=', 'available'),
        ])
        ordered = sorted(
            credits,
            key=lambda c: (c.expiry_date or dt_date.max, c.date_earned, c.id))
        plan = []
        remaining = days or 0.0
        for credit in ordered:
            if float_compare(remaining, 0.0, precision_digits=PREC) <= 0:
                break
            left = max(0.0, (credit.days or 0.0)
                       - credit._active_usage(exclude_request_id))
            take = min(left, remaining)
            if float_compare(take, 0.0, precision_digits=PREC) <= 0:
                continue
            plan.append((credit, take))
            remaining -= take
        return plan, max(0.0, remaining)

    # ------------------------------------------------------------------ #
    # Earning: sizing a declared day from the attendance                 #
    # ------------------------------------------------------------------ #
    @api.model
    def _full_day_threshold_hours(self, employee_id):
        """Hours on the clock below which a worked day off is worth half.

        The threshold is the one already used to call an ordinary day a half
        day, so "enough work for a full day" means the same thing on a rest day
        as it does on a Tuesday. When the half-day ladder is switched off
        (ratio 0) half the standard day stands in for it -- otherwise the
        threshold would be zero and a ten-minute appearance would earn a whole
        day back.
        """
        cfg = self.env['hr.attendance.late.config'].sudo().get_config_for_employee(
            employee_id)
        paid = cfg.get('daily_work_hours') or 0.0
        ratio = cfg.get('half_day_min_hours_ratio') or 0.0
        return (paid * ratio) if (paid and ratio) else (paid / 2.0)

    @api.model
    def _hours_worked_on(self, employee, day):
        """Closed attendance hours inside one office-local day.

        Summed here from a fresh search rather than read off
        hr.attendance.daily_total_hours: that compute does not depend on
        check_out, so a value cached at check-in can still read 0.0 at
        check-out and every credit would come out half.
        """
        start, end = self._day_window(employee, day)
        rows = self.env['hr.attendance'].sudo().search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', start),
            ('check_in', '<', end),
            ('check_out', '!=', False),
        ])
        total = 0.0
        for row in rows:
            if row.check_in and row.check_out and row.check_out > row.check_in:
                total += (row.check_out - row.check_in).total_seconds() / 3600.0
        return round(total, 2)

    @api.model
    def _credit_size(self, day_status):
        """(days earned, hours worked) for a worked day off.

        Nothing is earned until the employee has checked OUT: the size is
        decided by the hours on the clock, and there are none to count while
        they are still in.
        """
        att = day_status.attendance_id
        if not att or not att.check_in or not att.check_out:
            return 0.0, 0.0
        hours = self._hours_worked_on(day_status.employee_id, day_status.date)
        threshold = self._full_day_threshold_hours(day_status.employee_id.id)
        if threshold and hours < threshold:
            return 0.5, hours
        return 1.0, hours

    @api.model
    def _sync_for_day(self, day_status):
        """Size the declared credit for one day row, or withdraw it.

        Idempotent and safe to call on every check-in and check-out. It never
        CREATES a credit unless the declaration gate is switched off for the
        employee's office: on a gated office the declaration row already
        exists (that is what let the check-in through) and this only fills in
        the days.
        """
        if not day_status or not day_status.employee_id or not day_status.date:
            return self.browse()

        employee = day_status.employee_id
        company_id = employee.company_id.id or self.env.company.id
        policy = self._policy(company_id)
        cfg = self._office_config(employee)

        existing = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('date_earned', '=', day_status.date),
        ], limit=1)

        qualifies = (policy.get('comp_off_enabled')
                     and day_status.status == 'day_off')

        if not existing:
            if not qualifies or cfg.get('require_day_off_declaration', True):
                return self.browse()
            # Gate switched off for this office: the old behaviour, a credit
            # minted from the attendance itself.
            earned, hours = self._credit_size(day_status)
            if not earned:
                return self.browse()
            return self.sudo().create({
                'employee_id': employee.id,
                'date_earned': day_status.date,
                'days': earned,
                'hours_worked': hours,
                'source': self._source_for(employee, day_status.date),
                'day_status_id': day_status.id,
                'auto_created': True,
                'state': 'available',
            })

        if not existing.auto_created:
            # HR's word stands. Only remember which day row it belongs to.
            if not existing.day_status_id:
                existing.write({'day_status_id': day_status.id})
            return existing

        if existing.state not in ('declared', 'available'):
            return existing

        if not qualifies:
            # The day is a working day after all (a holiday was withdrawn),
            # or comp off was switched off. Withdraw the credit -- unless
            # leave has already been taken against it, which is a decision
            # for a person, not a sync.
            if existing._active_usage():
                _logger.warning(
                    '[comp-off] %s no longer qualifies but leave already '
                    'draws on it; left for HR', existing.display_name)
                return existing
            if existing.redemption_ids:
                existing.write({
                    'state': 'cancelled',
                    'note': ((existing.note or '')
                             + ' [withdrawn: day no longer qualifies]').strip(),
                })
                return existing
            existing.unlink()
            return self.browse()

        earned, hours = self._credit_size(day_status)
        vals = {}
        if existing.day_status_id != day_status:
            vals['day_status_id'] = day_status.id

        if earned:
            # Never shrink below what leave already holds: a shorter day
            # re-graded later must not turn approved leave into unpaid leave.
            target = max(earned, existing._active_usage())
            if float_compare(existing.days or 0.0, target, precision_digits=PREC) != 0:
                vals['days'] = target
            if float_compare(existing.hours_worked or 0.0, hours, precision_digits=PREC) != 0:
                vals['hours_worked'] = hours
            if existing.state == 'declared':
                vals['state'] = 'available'
        # Not checked out yet: a Declared row stays at 0 days. An Available
        # credit whose attendance is reopened (the KRA bridge reopens a
        # closed day for a second session) is never demoted: it keeps its
        # size until the next check-out resizes it.

        if vals:
            existing.write(vals)
        return existing

    @api.model
    def _source_for(self, employee, day):
        company_id = employee.company_id.id or self.env.company.id
        Holiday = self.env['hr.public.holiday'].sudo()
        return ('public_holiday'
                if Holiday.is_public_holiday(day, company_id)
                else 'weekly_off')

    # ------------------------------------------------------------------ #
    # The check-in gate                                                  #
    # ------------------------------------------------------------------ #
    @api.model
    def _day_kind(self, employee, day, cfg=None):
        """('working' | 'weekly_off' | 'public_holiday', holiday name)."""
        if cfg is None:
            cfg = self._office_config(employee)
        company_id = employee.company_id.id or self.env.company.id
        holiday = self.env['hr.public.holiday'].sudo().search([
            ('date', '=', day),
            ('company_id', '=', company_id),
        ], limit=1)
        if holiday:
            return 'public_holiday', holiday.name or ''
        working_days = cfg.get('working_days', [0, 1, 2, 3, 4, 5])
        if is_weekly_off_day(day, working_days, cfg.get('monthly_offs')):
            return 'weekly_off', ''
        return 'working', ''

    @api.model
    def _check_in_gate(self, employee, day):
        """May this employee check in on `day`?

        Returns a dict: allowed, reason, kind, holiday_name, gate_enabled,
        comp_off_enabled, credit (recordset, possibly empty), message.

        Used by the hr.attendance constraint (every entry point: the app's
        systray route, the KRA bridge, the backend form) and by the routes the
        app reads today's state from, so all of them agree.
        """
        cfg = self._office_config(employee)
        kind, holiday_name = self._day_kind(employee, day, cfg)
        company_id = employee.company_id.id or self.env.company.id
        policy = self._policy(company_id)
        comp_off_enabled = bool(policy.get('comp_off_enabled'))
        gate_enabled = (comp_off_enabled
                        and bool(cfg.get('require_day_off_declaration', True)))
        credit = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('date_earned', '=', day),
            ('state', '!=', 'cancelled'),
        ], limit=1)

        info = {
            'kind': kind,
            'holiday_name': holiday_name,
            'gate_enabled': gate_enabled,
            'comp_off_enabled': comp_off_enabled,
            'credit': credit,
            'message': '',
        }
        if kind == 'working':
            info.update(allowed=True, reason='working_day')
        elif not gate_enabled:
            info.update(allowed=True, reason='gate_off')
        elif credit:
            info.update(allowed=True, reason='declared')
        else:
            if kind == 'public_holiday':
                what = (_('a public holiday (%s)', holiday_name) if holiday_name
                        else _('a public holiday'))
            else:
                what = _('a weekly off')
            when = (_('Today') if day == self._office_today(employee, cfg)
                    else day.strftime('%d %b %Y'))
            info.update(
                allowed=False, reason='not_declared',
                message=_(
                    "%(when)s is %(what)s. Tap 'I am working today' in the "
                    "Attendance app before checking in, so the day earns a "
                    "compensatory off.", when=when, what=what))
        return info

    @api.model
    def check_in_allowed(self, employee_id=None, date=None):
        """RPC form of the gate, JSON-safe.

        With no employee id it answers for the signed-in user. A user with no
        employee record is allowed through, exactly as the KRA bridge treats
        them today (no employee, no attendance, nothing to gate).
        """
        if employee_id:
            self._assert_may_read(employee_id)
            employee = self.env['hr.employee'].sudo().browse(int(employee_id))
        else:
            employee = self._employee_for_user()
        if not employee or not employee.exists():
            return {'allowed': True, 'reason': 'no_employee', 'kind': 'working',
                    'holiday_name': '', 'message': ''}
        day = fields.Date.to_date(date) if date else self._office_today(employee)
        info = self._check_in_gate(employee, day)
        credit = info.pop('credit')
        info['date'] = str(day)
        info['credit_id'] = credit.id or False
        info['credit_state'] = credit.state if credit else False
        return info

    @api.model
    def _employee_for_user(self, user=None):
        user = user or self.env.user
        return self.env['hr.employee'].sudo().search(
            [('user_id', '=', user.id)], limit=1)

    # ------------------------------------------------------------------ #
    # Declaring: "I am working today"                                    #
    # ------------------------------------------------------------------ #
    def _payload(self):
        """The JSON shape the app reads for one credit."""
        self.ensure_one()
        rec = self.sudo()
        return {
            'id': rec.id,
            'date_earned': str(rec.date_earned) if rec.date_earned else '',
            'days': rec.days or 0.0,
            'source': rec.source or '',
            'holiday_name': rec.holiday_name or '',
            'state': rec.state,
            'expiry_date': str(rec.expiry_date) if rec.expiry_date else '',
            'days_used': rec.days_used or 0.0,
            'days_left': rec.days_left or 0.0,
            'days_lapsed': rec.days_lapsed or 0.0,
            'hours_worked': rec.hours_worked or 0.0,
            'declared_at': str(rec.declared_at) if rec.declared_at else '',
            'auto_created': bool(rec.auto_created),
            'note': rec.note or '',
            'redemptions': [{
                'id': line.id,
                'leave_request_id': line.leave_request_id.id,
                'days': line.days or 0.0,
                'request_state': line.leave_request_id.state,
                'from_date': str(line.leave_request_id.from_date or ''),
                'to_date': str(line.leave_request_id.to_date or ''),
            } for line in rec.redemption_ids],
        }

    @api.model
    def _today_status_for(self, employee):
        """Everything the Home screen needs about today's day-off state."""
        cfg = self._office_config(employee)
        day = self._office_today(employee, cfg)
        info = self._check_in_gate(employee, day)
        credit = info.pop('credit')
        start, end = self._day_window(employee, day, cfg)
        Attendance = self.env['hr.attendance'].sudo()
        todays = Attendance.search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', start), ('check_in', '<', end),
        ])
        closed_today = any(a.check_out for a in todays)
        can_declare = (info['kind'] != 'working' and info['gate_enabled']
                       and not credit and not closed_today)
        can_withdraw = bool(credit and credit.state == 'declared'
                            and credit.auto_created and not todays)
        return {
            'date': str(day),
            'is_working_day': info['kind'] == 'working',
            'kind': info['kind'],
            'holiday_name': info['holiday_name'],
            'comp_off_enabled': info['comp_off_enabled'],
            'gate_enabled': info['gate_enabled'],
            'check_in_allowed': info['allowed'],
            'blocked_message': info['message'],
            'can_declare': can_declare,
            'can_withdraw': can_withdraw,
            'declaration': credit._payload() if credit else False,
            'full_day_hours': self._full_day_threshold_hours(employee.id),
        }

    @api.model
    def declare_for_today(self, employee, note=False):
        """Write today's declaration for this employee, idempotently.

        The row is what lets the check-in through. It is created with sudo
        AFTER the checks: the employee's own ACL on this model is read-only,
        and the ownership question was already settled by whoever resolved
        `employee` from the session.
        """
        cfg = self._office_config(employee)
        day = self._office_today(employee, cfg)
        company_id = employee.company_id.id or self.env.company.id
        policy = self._policy(company_id)
        if not policy.get('comp_off_enabled'):
            raise exceptions.UserError(_(
                'Compensatory off is switched off in the leave policy.'))
        kind, _holiday_name = self._day_kind(employee, day, cfg)
        if kind == 'working':
            raise exceptions.UserError(_(
                'Today is an ordinary working day. Just check in.'))

        existing = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('date_earned', '=', day),
        ], limit=1)
        if existing:
            if existing.state == 'cancelled':
                raise exceptions.UserError(_(
                    'HR has withdrawn the compensatory off for today. '
                    'Please contact HR.'))
            return existing

        start, end = self._day_window(employee, day, cfg)
        closed = self.env['hr.attendance'].sudo().search_count([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', start), ('check_in', '<', end),
            ('check_out', '!=', False),
        ])
        if closed:
            raise exceptions.UserError(_(
                'You have already checked out today, so the day cannot be '
                'declared now. Ask HR to add the compensatory off.'))

        vals = {
            'employee_id': employee.id,
            'date_earned': day,
            'days': 0.0,
            'source': 'public_holiday' if kind == 'public_holiday' else 'weekly_off',
            'state': 'declared',
            'auto_created': True,
            'declared_at': fields.Datetime.now(),
            'declared_by': self.env.user.id,
            'note': note or False,
        }
        try:
            with self.env.cr.savepoint():
                credit = self.sudo().create(vals)
        except Exception:
            # A double tap racing itself into the unique index: the first
            # one won, and that row is the answer.
            credit = self.sudo().search([
                ('employee_id', '=', employee.id),
                ('date_earned', '=', day),
            ], limit=1)
            if not credit:
                raise

        # If the KRA board already opened a workday for today, its check-in
        # was refused by the gate. Adopt that session now so the employee
        # need not end and restart their day.
        try:
            with self.env.cr.savepoint():
                credit._adopt_open_kra_session()
        except Exception:
            _logger.exception(
                '[comp-off] could not adopt the open KRA session for %s',
                credit.display_name)
        return credit

    def _adopt_open_kra_session(self):
        """Create today's check-in from an already-open KRA workday session.

        Runtime-guarded: this module does not depend on the KRA/KPI app or
        the bridge, and neither is modified. If `kpi.work.session` (with the
        bridge's `hr_attendance_id`) is not installed this is a no-op.
        """
        self.ensure_one()
        env = self.env
        Attendance = env['hr.attendance'].sudo()
        if 'kpi.work.session' not in env:
            return Attendance.browse()
        Session = env['kpi.work.session'].sudo()
        needed = ('hr_attendance_id', 'user_id', 'login_at', 'state')
        if any(f not in Session._fields for f in needed):
            return Attendance.browse()
        employee = self.employee_id.sudo()
        if not employee.user_id:
            return Attendance.browse()

        start, end = self._day_window(employee, self.date_earned)
        session = Session.search([
            ('user_id', '=', employee.user_id.id),
            ('hr_attendance_id', '=', False),
            ('state', '!=', 'closed'),
            ('login_at', '>=', start),
            ('login_at', '<', end),
        ], order='login_at asc', limit=1)
        if not session:
            return Attendance.browse()

        attendance = Attendance.search([
            ('employee_id', '=', employee.id),
            ('check_in', '>=', start),
            ('check_in', '<', end),
        ], order='check_in desc', limit=1)
        if not attendance:
            attendance = Attendance.with_context(
                skip_late_reason_required=True).create({
                    'employee_id': employee.id,
                    'check_in': session.login_at or fields.Datetime.now(),
                })
        session.write({'hr_attendance_id': attendance.id})
        _logger.info('[comp-off] adopted KRA session %s into attendance %s',
                     session.id, attendance.id)
        return attendance

    @api.model
    def withdraw_declaration(self, employee):
        """"Not working after all": remove today's declaration, if unused."""
        cfg = self._office_config(employee)
        day = self._office_today(employee, cfg)
        credit = self.sudo().search([
            ('employee_id', '=', employee.id),
            ('date_earned', '=', day),
        ], limit=1)
        if not credit:
            return True
        if credit.state != 'declared' or not credit.auto_created:
            raise exceptions.UserError(_(
                'This day has already earned a compensatory off.'))
        start, end = self._day_window(employee, day, cfg)
        if self.env['hr.attendance'].sudo().search_count([
                ('employee_id', '=', employee.id),
                ('check_in', '>=', start), ('check_in', '<', end)]):
            raise exceptions.UserError(_(
                'You have already checked in today, so the declaration stays.'))
        credit.unlink()
        return True

    @api.model
    def preview_redemption(self, employee, from_date, to_date=False,
                           is_half_day=False):
        """What a comp-off leave over these dates would draw on.

        Same day count the request will store and the same allocation
        action_submit will make, so what the apply sheet shows is what
        happens.
        """
        company_id = employee.company_id.id or self.env.company.id
        policy = self._policy(company_id)
        enabled = bool(policy.get('comp_off_enabled'))
        from_date = fields.Date.to_date(from_date) if from_date else False
        to_date = fields.Date.to_date(to_date) if to_date else False
        days = (self.env['hr.leave.request']._count_working_days(
            employee.id, from_date, to_date, is_half_day)
            if from_date else 0.0)
        balance = (self.sudo().get_comp_off_balance(employee.id)['balance']
                   if enabled else 0.0)
        if enabled:
            plan, short = self._plan_allocation(employee.id, days)
        else:
            plan, short = [], days
        return {
            'enabled': enabled,
            'number_of_days': days,
            'balance': balance,
            'covered': sum(take for _c, take in plan),
            'shortfall': short,
            'allocation': [{
                'credit_id': credit.id,
                'date_earned': str(credit.date_earned),
                'source': credit.source or '',
                'holiday_name': credit.holiday_name or '',
                'expiry_date': str(credit.expiry_date) if credit.expiry_date else '',
                'days': take,
            } for credit, take in plan],
        }

    # ------------------------------------------------------------------ #
    # Manager actions                                                    #
    # ------------------------------------------------------------------ #
    def action_cancel(self):
        """Withdraw a credit that should not have been earned."""
        for rec in self:
            if rec.state == 'cancelled':
                continue
            if rec.state == 'consumed' or rec._active_usage():
                raise exceptions.UserError(_(
                    'This compensatory off has already been claimed by a leave '
                    'request. Cancel or reject that request first.'))
            rec.state = 'cancelled'

    def action_restore(self):
        """Put a cancelled or expired credit back."""
        today = fields.Date.today()
        for rec in self:
            if rec.state not in ('cancelled', 'expired'):
                continue
            vals = {'state': 'available', 'days_lapsed': 0.0}
            if not rec.days:
                # A declaration that was cancelled never had a size.
                vals['days'] = 1.0
            if rec.expiry_date and rec.expiry_date < today:
                # Restoring an expired credit is a deliberate grant; give it
                # a fresh window from today, or the cron takes it straight
                # back tonight.
                window = self._policy(rec.company_id.id).get('comp_off_expiry_days') or 0
                vals['expiry_date'] = (today + timedelta(days=window)) if window > 0 else False
            rec.write(vals)
        self._refresh_state()

    def action_grant(self):
        """HR closes a declaration by hand -- the employee worked but the
        check-out never came (or the day was recorded some other way)."""
        for rec in self:
            if rec.state != 'declared':
                continue
            rec.write({
                'state': 'available',
                'days': rec.days or 1.0,
            })

    # ------------------------------------------------------------------ #
    # Expiry and carry forward                                           #
    # ------------------------------------------------------------------ #
    def _expire_unspent(self):
        """Expire this credit, losing only the part nobody has claimed."""
        self.ensure_one()
        self.write({
            'state': 'expired',
            'days_lapsed': max(0.0, (self.days or 0.0) - self._active_usage()),
        })

    @api.model
    def _lapse_stale_declarations(self, today):
        """A declaration for a day that has passed, with no attendance, was
        never worked: drop it. One with an attendance still open is left for
        HR (action_grant); one whose attendance closed is sized now."""
        lapsed = 0
        stale = self.sudo().search([
            ('state', '=', 'declared'),
            ('auto_created', '=', True),
            ('date_earned', '<', today),
        ])
        for decl in stale:
            start, end = self._day_window(decl.employee_id, decl.date_earned)
            atts = self.env['hr.attendance'].sudo().search([
                ('employee_id', '=', decl.employee_id.id),
                ('check_in', '>=', start), ('check_in', '<', end),
            ])
            if not atts:
                decl.unlink()
                lapsed += 1
            elif all(a.check_out for a in atts) and decl.day_status_id:
                self._sync_for_day(decl.day_status_id)
            else:
                _logger.info('[comp-off] %s still has an open attendance; '
                             'left for HR', decl.display_name)
        return lapsed

    @api.model
    def _cron_expire_credits(self):
        """Retire credit the policy no longer covers.

        Three rules, in order:

          0. declarations for past days that were never worked are dropped;
          1. anything past its own `expiry_date`;
          2. at the turn of the year, whatever prior-year credit the carry
             forward cap does not cover -- all of it when carry forward is off.

        Only genuinely UNSPENT credit is retired: the part held by pending or
        approved leave stays, so expiry never quietly takes back a day the
        employee has already been paid out for.

        Returns the number of credits retired.
        """
        today = fields.Date.today()
        retired = 0

        lapsed = self._lapse_stale_declarations(today)
        if lapsed:
            _logger.info('[comp-off] dropped %s unused declaration(s)', lapsed)

        stale = self.sudo().search([
            ('state', '=', 'available'),
            ('expiry_date', '!=', False),
            ('expiry_date', '<', today),
        ])
        for credit in stale:
            credit._expire_unspent()
            retired += 1

        # --- year-end carry forward ---
        live = self.sudo().search([('state', '=', 'available')])
        for employee in live.mapped('employee_id'):
            policy = self._policy(employee.company_id.id)
            if not policy.get('comp_off_enabled'):
                continue

            unspent = [
                c for c in live
                if c.employee_id == employee
                and c.date_earned and c.date_earned.year < today.year
                and (c.days_left or 0.0) > 0
            ]
            if not unspent:
                continue

            cap = 0.0
            if policy.get('comp_off_carry_forward_enabled'):
                cap = float(policy.get('comp_off_max_carry_forward_days') or 0)

            # Newest first: the credit with the most life left is the one worth
            # keeping. The cap is tested BEFORE adding, so a credit straddling
            # the limit survives whole -- rounding in the employee's favour is
            # the right direction for a day they have already worked.
            kept = 0.0
            for credit in sorted(unspent,
                                 key=lambda c: (c.date_earned, c.id),
                                 reverse=True):
                if kept < cap:
                    kept += credit.days_left or 0.0
                    continue
                credit._expire_unspent()
                retired += 1

        if retired:
            _logger.info('[comp-off] retired %s credit(s)', retired)
        return retired
