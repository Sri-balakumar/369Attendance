/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

// Copy for the yellow "how to use this page" banner, keyed by the `guide_key`
// each menu action puts in its context. `model` must match the view's model;
// `views` (optional) limits it to list or form.
//
// Facts every entry respects: lateness costs nothing, a half day is the only
// deduction, an absent day is simply not earned, and days off and public
// holidays are always paid. The app's Config tab carries the same guide
// (src/screens/config/guides.js) -- keep the two in step.
export const GUIDES = {
    late_records: {
        model: "hr.attendance",
        title: _t("How to use Late Records"),
        steps: [
            _t("Every check-in after Office Start + Grace Minutes is listed here, with how late it was and the reason given."),
            _t("Use the Late Only and Missing Reason filters, and group by Employee or Month, to see who is often late."),
            _t("Open a row to read the late reason, or press Enter Late Reason to fill it in."),
            _t("Being late costs nothing. Only a Half Day is deducted from pay; see Day Status for how each day was graded."),
            _t("Changed the office hours? Go to Configuration > Office Hours & Working Days and press Recompute Late Records."),
        ],
    },
    day_status: {
        model: "hr.attendance.day.status",
        title: _t("How to use Day Status"),
        steps: [
            _t("There is one row per employee per day, saying what the day was: Present, Late, Half Day, Leave, Absent or Day Off."),
            _t("Rows appear when someone checks in. Absent rows are added automatically once the office passes Late Window Ends."),
            _t("Filter by Absent, Half Day, Leave, Late or Has Deduction. This Month is on by default."),
            _t("A Half Day is the only status that costs money. An absent day is simply not earned, and being late is free."),
            _t("After changing the office hours or thresholds, open a row and press Recompute."),
        ],
    },
    absent_today: {
        model: "hr.attendance.day.status",
        title: _t("How to use Absent Today"),
        steps: [
            _t("This lists everyone expected at work today who has not checked in by Late Window Ends and has no approved leave or WFH."),
            _t("The list is filled automatically every 30 minutes, so it fills after the late window closes, not at office start."),
            _t("Someone who checks in later drops off this list by themselves."),
            _t("Wrongly marked absent? Approve a leave request or record the attendance, and the day is re-graded."),
        ],
    },
    monthly_summary: {
        model: "hr.attendance.late.summary.wizard",
        title: _t("How to use Monthly Summary"),
        steps: [
            _t("Pick the Month and Year. Optionally pick a Department or specific Employees; empty means everyone."),
            _t("Press Generate Summary. You get one line per employee with their late days and total late time."),
            _t("Only the first check-in of each day counts, and arrivals after Late Window Ends are not counted as late."),
            _t("Generating replaces the previous summary, so run it again any time."),
            _t("Lateness costs nothing. For pay, use Employee Report > Generate Report."),
        ],
    },
    office_hours: {
        model: "hr.attendance.late.config",
        title: _t("How to set office hours and working days"),
        steps: [
            _t("Keep one record per company. Add another record with a Department to give that department different rules."),
            _t("Set Office Start and End, Grace Minutes, and the day status thresholds, then tick the Working Days."),
            _t("Unticked days and public holidays are never marked Absent and are always paid."),
            _t("After any change, press Recompute Late Records so existing days follow the new rules."),
            _t("Switch Late Tracking off to keep recording check-ins without marking anyone late."),
        ],
    },
    public_holidays: {
        model: "hr.public.holiday",
        title: _t("How to use Public Holidays"),
        steps: [
            _t("Add each holiday with a name and a date."),
            _t("Nobody is marked Absent on a holiday, and it is always paid."),
            _t("A holiday on a working day takes that day out of the month's working days."),
            _t("A holiday that falls on a day off, such as a Sunday, changes nothing."),
            _t("Working on a holiday earns a Compensatory Off credit when Comp Off is switched on in Leave Policy."),
        ],
    },
    devices: {
        model: "hr.employee",
        title: _t("How to register a phone"),
        steps: [
            _t("Open the employee, enter the 10-digit Device ID shown on their phone, set a PIN and save."),
            _t("Each employee can have one device. The phone can mark attendance only while it is registered and Active."),
            _t("Switch Active off to block a lost or replaced phone without deleting it."),
            _t("Device Name and Last Used fill in by themselves after the first login from the phone."),
        ],
    },
    leave_all: {
        model: "hr.leave.request",
        title: _t("How to approve leave"),
        steps: [
            _t("The Pending filter is on, so these are the requests waiting for you. Open one and press Approve or Reject."),
            _t("A request is paid while both the yearly and the monthly allowance (Leave Policy) have room; the rest is unpaid."),
            _t("Only working days are counted. Days off and holidays inside the dates are not charged."),
            _t("If Auto-Approval is on, a request nobody answers is approved after the wait, and OdooBot shows as the approver."),
            _t("Approved leave shows as Leave in Day Status."),
        ],
    },
    leave_my: {
        model: "hr.leave.request",
        title: _t("How to ask for leave"),
        steps: [
            _t("Press New and choose the leave type, the dates (or tick Half Day) and a reason."),
            _t("Once saved, the request shows how many working days it covers and how many are paid or unpaid."),
            _t("Press Submit for Approval. Nothing is charged until it is approved."),
            _t("Compensatory Off uses the credits you earned by working a day off or a holiday."),
        ],
    },
    leave_approved_report: {
        model: "hr.leave.request",
        title: _t("How to read the Approved Leaves Report"),
        steps: [
            _t("Every approved leave is listed, grouped by employee."),
            _t("Use the date filters and group by month. The paid and unpaid days here are what payroll uses."),
            _t("To change a leave, open it, cancel it and file a new request."),
        ],
    },
    comp_off: {
        model: "hr.comp.off.credit",
        title: _t("How Compensatory Off works"),
        steps: [
            _t("A credit is created automatically when someone checks in on a day off or a public holiday."),
            _t("Read Days Left rather than the status: a credit stays Available until it expires or is cancelled."),
            _t("Employees spend credits by asking for leave of type Compensatory Off. The oldest credits are used first."),
            _t("Credits expire after the time set in Leave Policy (0 = never). Only the unspent part lapses."),
            _t("Press Cancel Credit for one that should not have been earned. Restore undoes it."),
        ],
    },
    leave_balances: {
        model: "hr.employee",
        views: ["list"],
        title: _t("How to read Leave Balances"),
        steps: [
            _t("There is one row per active employee for this year. Allowed comes from Leave Policy; Taken counts paid days asked for or approved."),
            _t("Comp Off Earned, Used and Left are counted separately from paid leave."),
            _t("These figures are worked out live, so the columns cannot be sorted or filtered."),
            _t("Press Credits to open an employee's comp-off credits."),
        ],
    },
    leave_policy: {
        model: "hr.leave.config",
        title: _t("How to set the leave policy"),
        steps: [
            _t("Keep one record per company."),
            _t("Set the Paid Leave Days per year and per month. A request is paid while both have room; the rest is unpaid."),
            _t("Unpaid days are deducted at the Monthly Wage divided by that month's working days. Untick the deduction to only record them."),
            _t("For Compensatory Off, switch it on and set when credits expire (0 = never)."),
            _t("Changes apply to requests decided from now on."),
        ],
    },
    auto_approve: {
        model: "hr.request.auto.approve.config",
        title: _t("How auto-approval works"),
        steps: [
            _t("Keep one record per company. With both switches off, nothing is ever approved automatically."),
            _t("Tick Leave, WFH or both, and set how long a request may wait."),
            _t("A request still waiting after that time is approved automatically, and OdooBot shows as the approver."),
            _t("A manager can still reject a request before the wait is over."),
        ],
    },
    wfh_all: {
        model: "hr.wfh.request",
        title: _t("How to approve work from home"),
        steps: [
            _t("The Pending filter is on. Open a request and press Approve or Reject."),
            _t("There is no separate WFH check-in. On an approved day the employee checks in as usual and it is recorded as work from home."),
            _t("An approved day with no check-in expires by itself the next day."),
            _t("Auto-Approval, under Configuration, can approve unanswered requests after a wait."),
        ],
    },
    wfh_my: {
        model: "hr.wfh.request",
        title: _t("How to ask to work from home"),
        steps: [
            _t("Press New, pick the date and give a reason, then press Submit for Approval."),
            _t("Once it is approved, check in as usual on that day. It is recorded as work from home automatically."),
            _t("An approved day you do not use expires by itself."),
        ],
    },
    field_settings: {
        model: "hr.employee.details.config",
        title: _t("How to choose which employee details are recorded"),
        steps: [
            _t("Start with the record for everyone. Tick the sections you need, then the fields inside them."),
            _t("Add a record for one employee only when that person should differ. It replaces the defaults for them."),
            _t("Everything starts switched off, so nothing shows on the employee form until it is ticked here."),
            _t("Salary is never shown to the employee."),
        ],
    },
    salary_components: {
        model: "hr.salary.component",
        title: _t("How salary components work"),
        steps: [
            _t("The preset components start switched off. Turn on the ones you use, or create your own earning or deduction."),
            _t("Only active components appear on employees and payslips."),
            _t("Drag the handle to put the lines in the order they print on the payslip."),
            _t("Earnings must add up to the employee's Monthly Wage, or the payroll run cannot be confirmed."),
        ],
    },
    statutory_id_types: {
        model: "hr.statutory.id.type",
        title: _t("How statutory ID types work"),
        steps: [
            _t("Turn on the identity numbers your company keeps, such as PAN, Aadhaar or UAN, or add your own."),
            _t("Optionally set a pattern the whole value must match, and the message to show when it does not."),
            _t("Required means every employee must have one. Confidential hides it from other people."),
            _t("The numbers are entered on the employee once Field Settings shows the Statutory section."),
        ],
    },
    payroll_runs: {
        model: "hr.payslip.run",
        title: _t("How to run payroll"),
        steps: [
            _t("Press New, choose the month and year, and save."),
            _t("Press Generate Payslips. Each payslip is worked out from Day Status and the employee's salary components."),
            _t("A yellow warning lists payslips whose earnings do not match the Monthly Wage. Fix those, generate again, then Confirm."),
            _t("Press Mark Paid once the money has gone out, and Print All Payslips for the PDFs. Back to Draft works until the run is paid."),
        ],
    },
    payslips: {
        model: "hr.payslip",
        title: _t("How to read payslips"),
        steps: [
            _t("Payslips are created by Generate Payslips on a payroll run. You don't type them in here."),
            _t("Each payslip shows the days behind the pay (working, paid, loss of pay, half days, leave) and every earning and deduction."),
            _t("Use the With Loss of Pay and Wage Mismatch filters. Press Print Payslip for the PDF."),
        ],
    },
    generate_report: {
        model: "hr.employee.report.wizard",
        title: _t("How to generate a report"),
        steps: [
            _t("Pick the month, year and company, then all employees or selected ones. A department is optional."),
            _t("Press Generate Report. It opens with a summary per employee and a day-by-day tab."),
            _t("Inside the report, Refresh recalculates from current data, and PDF Report and Excel Export download it."),
            _t("Every report is kept under Past Reports."),
        ],
    },
    past_reports: {
        model: "hr.employee.report",
        title: _t("How to use Past Reports"),
        steps: [
            _t("Every report generated so far is listed, with its totals. Open one to view it."),
            _t("Refresh inside a report recalculates it from today's data."),
            _t("For a new month, use Generate Report."),
        ],
    },
    help_documents: {
        model: "attendance.help.document",
        title: _t("How Help Documents work"),
        steps: [
            _t("Each record is one card in the Help menu: a name, a description, an icon and its order."),
            _t("Upload a PDF, write HTML, or both. Open guide shows the HTML; Open in PDF doc shows the PDF."),
            _t("Untick Active to hide a card."),
        ],
    },
};
