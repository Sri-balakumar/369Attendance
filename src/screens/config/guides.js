/**
 * The yellow "how to use this page" banner copy for every admin screen.
 *
 * Kept in one file so the manual reads as one voice and matches the Odoo side
 * (odoo_modules/hr_attendance_369/static/src/views/guide_banner/guides.js).
 * Facts every entry respects: lateness costs nothing, a half day is the only
 * deduction, an absent day is simply not earned, and days off and public
 * holidays are always paid.
 */
export const GUIDES = {
  hrHome: {
    title: 'Your HR page',
    steps: [
      'Today shows who is present, late, on leave or absent. Tap a box to see the names.',
      'Absent is marked once the late window ends, so early in the day it may be empty.',
      'Approvals shows what is waiting for you. The red number is how many.',
      'Open a request, check it, then Approve or Reject. Rules and settings are handled by your admin.',
    ],
  },
  hub: {
    title: 'Admin menu',
    intro:
      'Each row opens one admin screen, and every screen starts with a yellow guide like this one. ' +
      'A red badge shows how many items are waiting for you. This full menu is for admins; ' +
      'HR users get the simpler HR tab instead.',
  },

  lateRecords: {
    title: 'How to use Late Records',
    steps: [
      'Pick a month with the arrows in the header. The forward arrow stops at the current month.',
      'Each row is one late check-in, with how many minutes late the person was.',
      'The line above the list totals the late check-ins and late time for the month.',
      'Someone missing? Check that Late tracking is on in Office Hours & Working Days.',
      'Being late costs nothing. Only a Half Day is deducted from pay.',
    ],
  },
  dayStatus: {
    title: 'How to use Day Status',
    steps: [
      'Pick a month with the arrows in the header.',
      'The tiles count how many days got each label. Tap a tile to show only those days; tap it again to clear.',
      'Each row is one employee on one day, with the label and the times behind it.',
      'Rows appear as people check in. Absent rows are added automatically after Late Window Ends.',
    ],
  },
  absentToday: {
    title: 'How to use Absent Today',
    steps: [
      'This list is for today only. Pull down to refresh it.',
      'Each row is someone expected at work who has not checked in yet.',
      'People on approved leave or an approved WFH day are not listed.',
      'To follow up, look in All Leave Requests or All WFH Requests for a request still waiting.',
    ],
  },
  monthlySummary: {
    title: 'How to use Monthly Summary',
    steps: [
      'Choose the month, type the year, and optionally pick one department.',
      'Tap Generate. The server counts each employee’s late days for that month.',
      'Read the ranked list: late days and total late time per person.',
      'Generating replaces the previous summary for everyone, including in Odoo.',
    ],
  },

  leaveQueue: {
    title: 'How to approve leave',
    steps: [
      'Use the chips in the header. Pending needs a decision; the others are history.',
      'Each card shows who, the leave type and days, the dates and the status. “auto” means the server approved it.',
      'Tap a card to read the full request, then Approve or Reject it.',
      'The list reloads when you come back, so your decision shows straight away.',
    ],
  },
  wfhQueue: {
    title: 'How to approve work from home',
    steps: [
      'Use the chips in the header. Pending needs a decision; the others are history.',
      'Each card shows who, the date and the status. “auto” means the server approved it.',
      'Tap a card to read the full request, then Approve or Reject it.',
      'On an approved day the employee checks in as usual; it is recorded as work from home.',
    ],
  },
  requestDetail: {
    title: 'How to decide this request',
    steps: [
      'Check the dates, the days and the reason. For leave, the paid / unpaid split shows what it costs.',
      'Tap Approve and confirm.',
      'Or tap Reject and type a reason. The employee sees it, so make it useful.',
      'Only a pending request can be decided. If another manager got there first, the screen says so.',
    ],
  },
  requestDetailCancel: {
    title: 'How to decide a cancellation',
    steps: [
      'This leave is already approved. The employee is asking to cancel it; their reason is in the orange box.',
      'Approve cancellation cancels the leave and gives the days back to their balance.',
      'Keep leave leaves it approved. Type why; the employee sees it.',
      'Refused once payroll for those dates is confirmed or paid.',
    ],
  },
  approvedLeaves: {
    title: 'How to read Approved Leaves',
    steps: [
      'Pick a month with the arrows in the header. A leave spanning two months appears in both.',
      'The tiles total the days, paid days and unpaid days granted.',
      'Each row shows the employee, leave type, dates and days. An “unpaid” chip means some days were not covered.',
      'Requests still waiting are under All Leave Requests, not here.',
    ],
  },
  compOff: {
    title: 'How Compensatory Off works',
    steps: [
      'A credit is earned when someone taps I’m working today on a weekly off or a public holiday, then checks in and out. A full day earns 1, a short shift ½.',
      'Filter with the chips in the header. Declared means they said they are working but have not checked out yet.',
      'Tap a credit to see its details, or to grant, cancel or restore it.',
      'Tap Add a credit for a day the system missed.',
    ],
  },
  compOffNew: {
    title: 'How to add a credit by hand',
    steps: [
      'Pick the employee.',
      'Enter the day they worked.',
      'Choose Full day or Half day, and whether it was a weekly off or a public holiday.',
      'Tap Add credit. One credit per employee per day; a hand-added credit is never changed automatically.',
    ],
  },
  compOffExisting: {
    title: 'How to manage this credit',
    steps: [
      'The details show how much was credited, used and is left, and when it expires.',
      'Grant as earned makes a Declared credit Available when the check-out never came.',
      'Cancel credit stops the unspent part counting towards the balance.',
      'Restore brings a cancelled or expired credit back.',
      'There is no edit: used days come from the employee’s leave requests.',
    ],
  },
  leaveBalances: {
    title: 'How to read Leave Balances',
    steps: [
      'Pick a year with the arrows in the header.',
      'Paid leave shows Allowed, Taken and Left, from the Leave Policy quota.',
      'Comp off shows Earned, Used and Left. The two balances never mix.',
      'Tap an employee to open their comp-off credits.',
    ],
  },
  leavePolicy: {
    title: 'How to set the leave policy',
    steps: [
      'Paid leave: switch it on, then set the days allowed per year and per month.',
      'A request is paid only while both the yearly and monthly allowance have room; the rest is unpaid.',
      'Unpaid leave: choose whether unpaid days are deducted from the monthly wage.',
      'Compensatory off: switch it on and set when credits expire (0 = never).',
      'Tap Save. Changes apply to requests decided from now on.',
    ],
  },

  rulesList: {
    title: 'How attendance rules work',
    steps: [
      'The company-wide card applies to everyone.',
      'A department card overrides it for the people in that department.',
      'Each card shows the office hours, grace minutes and paid hours, and “Tracking off” if late tracking is disabled.',
      'Tap a card to edit it. “View only” means your role can read these rules but not change them.',
    ],
  },
  rulesForm: {
    title: 'How to edit these rules',
    steps: [
      'Late tracking is the master switch. Off means nobody is marked late.',
      'Scope sets the company, the department (or company-wide) and the office timezone.',
      'Office hours and Grace minutes decide what counts as on time; the Day status ladder decides Late, Half Day and Absent.',
      'Tick the working days. At least one is required.',
      'Tap Save. Saving re-grades the last 3 months so old records follow the new rules.',
    ],
  },
  holidays: {
    title: 'How to use Public Holidays',
    steps: [
      'Pick a year with the arrows in the header.',
      'Each row is one holiday. “Not counted” means it is recorded but does not change payroll.',
      'Tap a holiday to edit or remove it; tap Add a holiday to create one.',
      'Nobody is marked Absent on a holiday, and it is always paid.',
    ],
  },
  holidayForm: {
    title: 'How to add or edit a holiday',
    steps: [
      'Give the holiday a name and a date.',
      'Pick the company it applies to.',
      'Leave “Counts as a non-working day” on unless you only want the date recorded.',
      'Tap Save. Removing a holiday asks you to confirm, because it changes that month’s payroll.',
    ],
  },
  autoApproval: {
    title: 'How auto-approval works',
    steps: [
      'Switch on auto-approval for leave, for WFH, or both. They are independent.',
      'Set how long a request may wait, and the unit: minutes, hours or days.',
      'A request still pending after that wait is approved by the server, without anyone reviewing it.',
      'A wait of zero switches it off.',
      'Tap Save.',
    ],
  },

  fieldSettingsList: {
    title: 'How Field Settings work',
    steps: [
      '“Everyone (defaults)” decides which employee details are recorded for all staff.',
      'An “Exception” row applies to one employee and replaces the defaults for them.',
      'Each row counts how many fields are switched on. Tap one to edit it.',
    ],
  },
  fieldSettingsForm: {
    title: 'How to choose the fields',
    steps: [
      'Each section has a master switch. Off hides everything in it.',
      'With a section on, tick the individual fields to show.',
      'Tap Save. Salary is never shown to the employee in the app.',
    ],
  },
  salaryList: {
    title: 'How salary components work',
    steps: [
      'Earnings add up to the gross; deductions come off it to give the net.',
      'Each row shows the code, how it is worked out and the amount or percentage.',
      'Tap a component to edit or remove it; tap Add a component to create one.',
      'Earnings must add up to the employee’s Monthly Wage, or the payroll run cannot be confirmed.',
    ],
  },
  salaryForm: {
    title: 'How to add or edit a component',
    steps: [
      'Give it a name and a short code, for example BASIC or HRA.',
      'Choose Earning or Deduction.',
      'Choose how it is worked out: a fixed amount or a percentage.',
      'Pick the company and its position on the payslip.',
      'Tap Save.',
    ],
  },
  idTypesList: {
    title: 'How statutory ID types work',
    steps: [
      'Each row is one kind of identity number, for example PAN, Aadhaar or UAN.',
      'Required means every employee must have one. Confidential keeps it off other people’s screens.',
      '“validated” means values are checked against a pattern.',
      'Tap a row to edit or remove it; tap Add to create one.',
    ],
  },
  idTypeForm: {
    title: 'How to add or edit an ID type',
    steps: [
      'Give it a name and a code, and pick the company.',
      'Optionally add a pattern the value must match, and the message shown when it does not.',
      'Switch Required and Confidential as needed.',
      'Tap Save.',
    ],
  },

  payrollRuns: {
    title: 'How to run payroll',
    steps: [
      'Tap New payroll run and pick the month, year and company.',
      'Open the run to generate its payslips, confirm it, then mark it paid.',
      'Each row shows the state (Draft, Confirmed or Paid), the employee count and the total net.',
      'The badge on the Config menu counts draft runs still open.',
    ],
  },
  payrollRun: {
    title: 'How to finish this payroll run',
    steps: [
      'Generate payslips builds one payslip per employee from attendance and salary. You can generate again while it is Draft.',
      'Check the payslips. A wage mismatch must be fixed before the run can be confirmed.',
      'Confirm run locks the figures. Back to draft reopens it.',
      'Mark paid once the money has gone out. This cannot be undone.',
      'Payslip PDFs are printed in Odoo.',
    ],
  },
  payslips: {
    title: 'How to read payslips',
    steps: [
      'Opened from a run, this lists that month’s payslips; from the menu, every payslip.',
      'Each row shows the employee, paid days and net pay.',
      '“Mismatch” means the earnings disagree with the employee’s Monthly Wage.',
      'Tap a payslip for the full breakdown.',
    ],
  },
  payslip: {
    title: 'How to read this payslip',
    steps: [
      'Earnings and Deductions list every line. Net pay is the amount paid.',
      'Attendance shows the days behind the figures: working, present, half, absent, leave and loss-of-pay days.',
      'Leave balance shows the opening, taken and closing days for the month.',
      'This is read-only. To change it, generate the run again.',
    ],
  },

  generateReport: {
    title: 'How to generate a report',
    steps: [
      'Pick the month and type the year.',
      'Choose the company, optionally a department, and All or Selected employees.',
      'Tap Generate. The report opens and is saved under Past Reports.',
    ],
  },
  pastReports: {
    title: 'How to use Past Reports',
    steps: [
      'Each row is one saved report, with its month and final amount.',
      'Tap a report to open it.',
      'To bring a report up to date, open it and tap Recalculate.',
    ],
  },
  report: {
    title: 'How to read this report',
    steps: [
      'The totals show wage, deductions and the final amount for everyone in the report.',
      'Each employee row shows present and working days, late, unpaid and comp-off days, and the final amount.',
      'Tap an employee for the day-by-day lines.',
      'Recalculate refreshes the figures from current attendance.',
    ],
  },
  reportDetail: {
    title: 'How to read these lines',
    steps: [
      'Each card is one line captured for this employee: a day, a late record or a leave.',
      'Empty values are left out.',
      'Go back to the report for the totals.',
    ],
  },
};
