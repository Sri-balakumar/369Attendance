<!--
Content only. Every formatting decision lives in build_manual.py.

Dialect:
  %% BOOK: <subtitle> | <tagline>     starts a book, with its own cover
  # PART n  TITLE                     reversed-out part banner
  ## Title                            section heading
  ### Step n  Title                   step heading with a numbered badge
  plain line                          body paragraph, **bold** allowed
  - line                              bullet
  > LABEL  text                       callout box
  | a | b |                           table, first row is the header
  | IMAGE n | caption                 figure plate
  === sentence                        closing banner
  @@ END                              closing line

Leave a blank line between a table and anything else that starts with a pipe.
-->

%% BOOK: Administrator Guide | Set the rules, keep the approvals moving, and close the month's payroll.

## About This Guide

This is the guide for the person who runs **369 Attendance** for the company: the one who sets office hours and holidays, decides the leave policy, keeps the approval queues clear, and closes each month's payroll.

Everything in it happens on the phone, in the **Config** tab and the screens it opens. Every button name, field label and message is quoted from the app itself, so what you read here is what you will see on the screen. Where the app's own wording names the back office, this guide says the web console instead.

The **Config** tab shows only the sections your rights allow. If a section in this guide is missing from your menu, your login does not carry that right; users and their permissions are set up on the web console, not in the app.

Your own check-ins, leave and work-from-home requests work exactly as they do for everyone else, and are described in the Employee Guide. The approval screens you share with HR are described here in brief and in full in the HR Guide.

> TIP  Every admin screen opens with a yellow guide box that lists its steps. Tap the guide's title to fold it away for this visit; it comes back the next time you open the screen.

## 369 Attendance at a Glance

- **Every morning** — open **Config** and clear whatever carries a red badge: absentees, pending leave, pending work from home, draft payroll runs.
- **Once, at setup** — set **Office Hours & Working Days**, the day status ladder, **Public Holidays** and the **Leave Policy**.
- **As requests arrive** — approve or reject leave and work from home, and decide cancellations of approved leave.
- **As people work days off** — check **Compensatory Off** credits, and add one by hand when the system missed a day.
- **At month end** — create the payroll run, generate the payslips, confirm, and mark it paid; generate the month's report.

# PART 1   THE CONFIG TAB

### Step 1  Find the Config Tab

Along the bottom of the app sit three tabs: **Home**, **Config** and **Profile**. **Config** is the middle one, and it is only there for administrators.

It appears a moment after you sign in, once the server has confirmed what you are allowed to change. Somebody with HR rights but no administrator rights gets a smaller **HR** tab in the same place instead, holding today's attendance and the approval queues and no configuration at all.

The tab opens on a dark header reading **Config** and **Administration**, with the **Admin menu** guide beneath it: **Each row opens one admin screen, and every screen starts with a yellow guide like this one. A red badge shows how many items are waiting for you. This full menu is for admins; HR users get the simpler HR tab instead.**

| What you tap | What happens |
| **Home** | Your own attendance, leave and work from home |
| **Config** | The admin menu described in this guide |
| **Profile** | Your own **My details** |

| IMAGE 1 | The Config tab — the Admin menu guide and the Attendance status and Leave sections

### Step 2  Read the Admin Menu

The menu is grouped into sections, each with a heading in small capitals and a card of rows. Every row carries an icon, a name and a one-line caption, and opens one screen.

Each section is shown only when your login holds the right behind it, so two administrators can see different menus.

| Section | What lives in it |
| **ATTENDANCE STATUS** | **Late Records**, **Day Status**, **Absent Today**, **Monthly Summary** |
| **LEAVE** | **All Leave Requests**, **Approved Leaves Report**, **Compensatory Off**, **Leave Balances**, **Leave Policy** |
| **WORK FROM HOME** | **All WFH Requests** |
| **CONFIGURATION** | **Office Hours & Working Days**, **Public Holidays**, **Auto-Approval** |
| **EMPLOYEE DETAILS** | **Field Settings**, **Salary Components**, **Statutory ID Types** |
| **PAYROLL** | **Payroll Runs**, **Payslips** |
| **REPORTS** | **Generate Report**, **Past Reports** |

If you manage attendance but not leave, the **LEAVE** section is replaced by a shorter **LEAVE BALANCES** section holding just **Compensatory Off** and **Leave Balances**.

Four rows carry a red badge when something is waiting, and the numbers are fetched again every time you come back to the tab.

| Badge on | What it counts |
| **Absent Today** | People marked absent today |
| **All Leave Requests** | Leave requests still pending |
| **All WFH Requests** | Work-from-home requests still pending |
| **Payroll Runs** | Payroll runs still in draft |

A row with nothing waiting carries no badge at all, rather than a grey zero.

> TIP  If the header reads **Nothing assigned to you** and the card says **Checking what you can administer…**, the app is still asking the server about your rights. It clears on its own a moment later.

| IMAGE 2 | The lower half of the menu — Configuration, Employee details, Payroll with a draft-run badge, and Reports

### Step 3  Move Around the Admin Screens

Every screen the menu opens works the same way. A back chevron sits top left in the dark header, with the screen's name and a caption beside it. The yellow guide comes first, then the content.

| What you see | What it does |
| Back chevron | Returns to the menu |
| Arrows either side of a month or year | Page backwards and forwards; on most monthly screens the forward arrow stops at the current month |
| Chips under the header | Filter the list, such as **Pending** or **All** |
| Pull down on a list | Refreshes it from the server |
| **Retry** under a red message | Tries again after the server could not be reached |

These screens cover the tab bar while they are open. Use the back chevron, or the phone's back button, to return to **Config**.

# PART 2   ATTENDANCE STATUS

### Step 4  Look Through the Late Records

Tap **Late Records** (**Every late check-in**). The header shows a month with an arrow either side.

Each row is one late check-in: the person's name, the date, the time in and the time out (or **still in**), and an amber chip with how many minutes late they were. A line above the list totals the month, for example **3 late check-ins · 0h 45m total**.

An empty month says **Nobody was late**, and suggests checking that late tracking is on for the scope in Office Hours.

| What you see | What it means |
| The minutes chip | How late, counted from office start |
| **still in** | They have not checked out yet |
| The total line | Every late check-in in the month, and the late time added up |

> IMPORTANT  Being late costs nothing. The only pay cut on this side of the app is a **Half Day**, set by the day status ladder in PART 7.

| IMAGE 3 | Late Records — the month arrows, the guide and an empty month

### Step 5  See How Each Day Was Graded

Tap **Day Status** (**How each day was graded**) and pick a month.

A row of tiles counts how many days got each label. Tap a tile to show only those days, and tap it again, or **Show all**, to clear the filter.

Each row is one employee on one day, with a coloured label chip. Small chips add **WFH** or **On leave** where they apply, and **auto-stamped** marks a row the server wrote by itself. A red figure beneath the label is that day's deduction.

| Label | What it means |
| **Present** | In on time, or arrived after the late window closed |
| **Late** | In after office start plus grace; recorded, never charged |
| **Half Day** | Arrived after **Half day after**, or worked less than the **Half day below ratio**; half a day's pay is cut |
| **Leave** | Covered by approved leave |
| **Absent** | Never checked in on a working day |
| **Day Off** | A weekly off or holiday that was worked; never deducted, and earns comp off |

> IMPORTANT  Rows appear as people check in. Absent rows are stamped automatically only once the office passes **Late window ends**, and that time ships switched off. Until you set it in Office Hours, nobody is ever marked Absent and this screen can stay empty.

| IMAGE 4 | Day Status — an empty month, explaining that absentees wait for Late Window Ends

### Step 6  Check Who Is Absent Today

Tap **Absent Today** (**Expected in, never checked in**). The header shows today's date; there is no month picker, and pulling down refreshes the list.

A line reads, for example, **2 people have not checked in.**, and each row names one person with their **Absent** label. People on approved leave or an approved work-from-home day are never listed here. An empty list says **Nobody is absent today**.

| What you see | What to do |
| A name on the list | Check **All Leave Requests** or **All WFH Requests** for a request still waiting |
| An empty list early in the day | Normal — absentees are only marked once the late window ends |

> TIP  This list is built from the same automatic stamping as Day Status. With **Late window ends** left at 00:00 it stays empty however many people are missing.

| IMAGE 5 | Absent Today — the date in the header and the Nobody is absent today card

### Step 7  Generate the Monthly Summary

Tap **Monthly Summary** (**Late days per employee**). This screen builds a ranking rather than showing a list.

Choose the **Month**, type the **Year**, and optionally pick a **Department** (the default is **All departments**). Tap **Generate**.

The result ranks everyone by late days, each row showing their department, the number of days in the form **3d**, and the total late time. Two chips at the top count the employees and the late days. Tap **Change month** to go back to the picker.

| Field | What it controls |
| **Month** | The month to count |
| **Year** | Four digits; anything else gives **Give a four-digit year.** |
| **Department** | One department, or **All departments** |

An empty result reads **No chargeable late days**. Arrivals after **Late window ends**, and any check-in that is not the day's first, are deliberately left out of the count.

> IMPORTANT  Generating replaces the previous summary for everyone, including the copy on the web console. Two people generating at the same time overwrite each other.

| IMAGE 6 | Monthly Summary — Month, Year, Department and the Generate button

# PART 3   LEAVE REQUESTS

### Step 8  Work the Leave Queue

Tap **All Leave Requests** (**Approve or reject**). It opens on **Pending** — the requests waiting for a decision — with a count such as **2 requests** above the cards.

Each card shows who asked, the leave type and length (for example **Casual · 2 days** or **Comp Off · half day**), the dates, and a status chip. **Cancel asked** means an approved leave the employee now wants to cancel, and **auto** means the server approved it without anyone looking.

| Chip | What it shows |
| **Pending** | Waiting for a decision |
| **Cancellation** | Approved leave the employee has asked to cancel |
| **All** | Everything, whatever its state |
| **Approved** | Granted |
| **Rejected** | Turned down |

The list reloads every time you come back to it, so a decision you have just made shows straight away. An empty **Pending** list says **Nothing waiting**.

| IMAGE 7 | All Leave Requests — the filter chips and two pending requests

### Step 9  Approve or Reject a Leave Request

Tap a card. The request opens with the leave type and status, then **Dates**, **Days**, **Paid / unpaid**, and **Submitted**. A comp-off request also shows **Earned on** and **Comp-off balance**, which turns red if the balance is smaller than the request. Where the request costs money, **Deduction** appears in red. The employee's reason sits beneath under **REASON**.

**Paid / unpaid** is the figure to read first: it shows how many of the days the policy will pay and how many will not.

| What you tap | What happens |
| **Approve** | Asks **Approve this request?** — the person will be marked on leave, and those days leave the attendance grading. Confirm with **Approve** |
| **Reject** | Asks **Reject this request?** and for a **Reason for rejection**. The reason is required, and the employee sees it |

You will see **Request approved.** or **Request rejected.** and be returned to the queue.

Only a pending request can be decided. A request already decided shows, for example, **Already rejected — only a pending request can be decided.** If another manager got there first, the server's refusal is shown to you as it stands.

| IMAGE 8 | A pending leave request — Dates, Days, Paid / unpaid, the reason, and Reject and Approve

| IMAGE 9 | The Approve this request? confirmation

### Step 10  Decide a Cancellation, or Cancel Approved Leave Yourself

An approved leave the employee wants to cancel shows an orange **CANCELLATION REQUESTED** box with their reason and when they asked. Two buttons replace Approve and Reject.

| What you tap | What happens |
| **Approve cancellation** | Asks **Approve the cancellation?** The leave is cancelled and its days go back to the balance. You see **Leave cancelled.** |
| **Keep leave** | Asks **Keep this leave?** and for **Why it stays**. The leave stays approved and the employee sees your reason. You see **Cancellation declined; leave kept.** |

An approved leave with no cancellation request shows a single **Cancel this leave** button instead. It asks **Cancel this approved leave?**, and **Cancel leave** confirms it; **Back** leaves it alone.

> IMPORTANT  Cancelling approved leave is refused once that month's payroll is confirmed or paid. A confirmed run can be put **Back to draft** first; a paid run cannot.

| IMAGE 10 | An approved leave with CANCELLATION REQUESTED, and the Keep leave and Approve cancellation buttons

### Step 11  Read the Approved Leaves Report

Tap **Approved Leaves Report** (**What was granted**). The screen, titled **Approved Leaves**, shows one month at a time.

Three tiles total the month: **Days**, **Paid** and **Unpaid**. Each row below gives the employee, the leave type and dates, and the number of days (**½** for a half day). An amber chip such as **1 unpaid** means some of those days were not covered by the paid allowance.

A leave that runs across the end of a month appears in both months. Requests still waiting are not here — they live under **All Leave Requests**.

| IMAGE 11 | Approved Leaves — the Days, Paid and Unpaid tiles and one granted leave

# PART 4   COMPENSATORY OFF AND LEAVE BALANCES

### Step 12  Look Through the Comp-Off Credits

Tap **Compensatory Off** (**Credits for days off worked**).

A credit is earned when someone taps **I’m working today** on a weekly off or a public holiday, then checks in and out. A full day earns 1 and a short shift ½; the credit is sized when they check out.

The chips under the header filter the list. It opens on **Available**, with a line such as **1 day still unspent across 1 credit**.

| Chip | What it shows |
| **Available** | Earned and not yet spent |
| **Declared** | They said they were working, but have not checked out yet |
| **Used** | Fully taken by approved comp-off leave |
| **Expired** | Lapsed before it was used |
| **Cancelled** | Withdrawn by an administrator |
| **All** | Every credit |

Each row shows the date worked, the person, the source and what is left, in the form **Weekly off · 1 of 1 left · manual**. **manual** marks a credit added by hand, and an available credit with an expiry adds **until** and the date.

| IMAGE 12 | Compensatory Off — the filter chips, one available credit and the Add a credit button

### Step 13  Add a Credit by Hand

Use this for a day off the system did not catch — a check-in that never happened on the phone, for example. Tap **Add a credit** at the foot of the list.

| Field | What it controls |
| **Employee** | Who worked the day. Leaving it empty gives **Pick an employee.** |
| **Day worked** | The day off they worked; it cannot be in the future |
| **Credit** | **Full day (1)** or **Half day (0.5)** |
| **Source** | **Weekly off** or **Public holiday** |
| **Note (optional)** | Anything worth recording |

Tap **Add credit**. You will see **Credit added.**

> IMPORTANT  One credit per employee per day. A credit added by hand is never resized or withdrawn by later check-ins, so check the figure before you save it.

| IMAGE 13 | Add credit — Employee, Day worked, Credit, Source and Note

### Step 14  Grant, Cancel or Restore a Credit

Tap a credit to open **Comp-off credit**. It shows the date and a status chip, then **Employee**, **Source**, **Credited**, **Used**, **Left**, **Expires** and **Created**, plus **Lapsed**, **Holiday**, **Hours worked** and **Note** where they apply. If a leave has spent any of it, a **Used by** card lists which.

There is no edit. The used figure comes from the employee's leave requests, not from this screen. What you can do depends on the state.

| What you tap | When it is offered | What happens |
| **Grant as earned** | **Declared** | Makes the credit **Available** when the check-out never came. You see **Credit granted.** |
| **Cancel credit** | Anything not cancelled or used | Asks **Cancel this credit?** The unspent part stops counting towards the balance. You see **Credit cancelled.** |
| **Restore** | **Cancelled** or **Expired** | Brings the credit back. You see **Credit restored.** |

A credit whose expiry date has passed shows **Its expiry date has passed. Restoring gives it a fresh expiry window from today.**

> TIP  If any of the credit is already used by a leave, the server refuses to cancel it until that leave is cancelled or rejected.

| IMAGE 14 | An available credit — Credited, Used, Left, Expires and the Cancel credit button

| IMAGE 15 | The Cancel this credit? confirmation

| IMAGE 16 | The same credit once cancelled, now offering Restore

### Step 15  Read the Leave Balances

Tap **Leave Balances** (**Paid and comp off, per employee**) and pick a year with the arrows.

Each employee has a card with their department and two ledgers side by side. They never mix: a comp-off leave is paid out of the comp-off balance, never out of the paid-leave quota.

| Ledger | Its three figures |
| **Paid leave** | **Allowed**, **Taken** and **Left**, from the Leave Policy quota |
| **Comp off** | **Earned**, **Used** and **Left** |

Tap a card to open **Compensatory Off** for just that employee, with their name in the header. **Add a credit** from there starts with them already chosen.

| IMAGE 17 | Leave Balances — one employee's Paid leave and Comp off ledgers

# PART 5   LEAVE POLICY

### Step 16  Set Paid and Unpaid Leave

Tap **Leave Policy** (**Paid days, comp off**). There is one policy for the company, and the header shows the company's name.

If no policy has been saved yet, an amber note warns: **No leave policy is saved yet, so every leave is paid as UNPAID and deducted. These are the suggested defaults. Check them and tap Save to create the policy.**

| Field | What it controls |
| **Paid leave** | The master switch. **Off means every leave day is unpaid, whatever the quota below says.** |
| **Paid days per year** | The yearly paid allowance |
| **Accrual per month** | How much of it is earned each month |
| **Deduct unpaid leave** | **Charge unpaid days against the monthly wage. Off records them without any deduction.** |

A request is paid only while both the yearly and the monthly allowance have room; the rest of it is unpaid. The balance strip on the employee's Leave screen reads from these two figures.

If the monthly figure can never add up to the yearly one, the app stops you with a message such as **At 1/month nobody reaches 15 days in a year.**

> IMPORTANT  Paid leave does not carry forward. It resets each year, and there is deliberately no carry-forward switch for it.

| IMAGE 18 | Leave Policy — the Paid leave and Unpaid leave cards

### Step 17  Set Compensatory Off

The **Compensatory off** switch decides whether working a weekly off or a public holiday earns a day back. A full day worked earns 1, a short day 0.5.

With it on, three more controls appear.

| Field | What it controls |
| **Expires after (days, 0 = never)** | Days from the date worked until an unused credit lapses |
| **Carry forward** | **Let unused comp offs roll into next year, up to the cap below.** |
| **Maximum comp offs carried** | The cap, shown when **Carry forward** is on |

Every number here must be 0 or more; the expiry field says so with **Days, 0 or more (0 never expires).**

| IMAGE 19 | The Compensatory off card with expiry, Carry forward and the cap

### Step 18  Email HR When Leave Is Submitted

The **Notifications** card holds one switch, **Email HR on submission**. With it on, an email goes to the addresses you list the moment anyone submits a leave request. It needs an outgoing mail server set up on the web console.

Type the addresses into **Recipients (comma-separated)**, for example two addresses separated by a comma.

Tap **Preview email** to see exactly what HR will receive. The popup, **Email preview (sample)**, shows a sample request on white paper with its subject, the request's details and a **Review and approve** button, and says how many people it goes to. Tap **Close** when you are done.

> TIP  The preview uses the recipients already saved. If you have just changed them, tap **Save** first and preview afterwards.

| IMAGE 20 | The Email preview (sample) popup over the Notifications card

### Step 19  Save the Policy

Tap **Save**. You will see **Leave policy updated.** (or **Leave policy created.** the first time) and be returned to the menu. **Cancel** leaves without saving.

> IMPORTANT  Policy changes apply to requests decided from now on. Leave already approved keeps the paid and unpaid split it was given.

# PART 6   WORK FROM HOME REQUESTS

### Step 20  Work the WFH Queue

Tap **All WFH Requests** (**Approve or reject**). Like the leave queue it opens on **Pending**, and each card shows who asked, **Work from home**, the date and a status chip, with **auto** where the server approved it.

| Chip | What it shows |
| **Pending** | Waiting for a decision |
| **All** | Everything |
| **Approved** | Granted, day not yet worked |
| **Done** | Checked in and out on the day |
| **Rejected** | Turned down |

A request can also show **Checked in**, **Cancelled** or **Expired** under **All**.

| IMAGE 21 | All WFH Requests — the filter chips and one pending request

### Step 21  Decide a WFH Request

Tap a card. The request shows **Date**, **Submitted** and the **REASON**, and, once the day has been worked, **Worked** with the check-in time and hours.

| What you tap | What happens |
| **Approve** | Asks **Approve this request?** — the person will be able to check in from home on that date |
| **Reject** | Asks **Reject this request?** and for a **Reason for rejection**, which is required |

On an approved day the employee checks in as usual, and the day is recorded as work from home.

| IMAGE 22 | A pending work-from-home request with Reject and Approve

| IMAGE 23 | The Reject this request? prompt with its reason box

# PART 7   OFFICE HOURS, HOLIDAYS AND AUTO-APPROVAL

### Step 22  Read the Rule Cards

Tap **Office Hours & Working Days** (**Grace, ladder, working days**). The screen, titled **Office hours**, lists one card per set of rules.

The **Company-wide** card applies to everyone. A department card overrides it for the people in that department — **A department row takes precedence over the company-wide one for its own people.**

Each card shows the office hours, the grace minutes and the paid hours, for example **08:00 – 17:00**, **16 min grace** and **9 h paid**.

| What you see | What it means |
| **Company-wide** | The rules everyone falls back to |
| A department name | Rules for that department only |
| **Tracking off** | Late tracking is switched off for that card |
| **View only** | Your role can read these rules but not change them |

> IMPORTANT  You cannot add a new set of rules in the app — there is no Add button. A department's own rules are created on the web console; here you open and change the ones that exist.

| IMAGE 24 | Office hours — the Company-wide card with its hours, grace and paid hours

### Step 23  Set Late Tracking and the Scope

Tap a card to open its rules. The form is long and runs in sections, top to bottom.

| Field | What it controls |
| **Late tracking** | The master switch. Off, people can still check in, but nobody is marked late and no late figures are kept |
| **Require late reason** | Asks for a reason when a late check-in is entered or edited on the web console. App check-ins are never blocked |
| **Company** | The company these rules belong to; required |
| **Department** | A department, or **Company-wide (no department)** |
| **Office timezone** | The office clock; empty means **Each employee's own** |

Every check-in is converted to the office timezone before it is compared with office start, so where the server sits does not matter.

> TIP  Switching late tracking off hides the grace settings and shows a note. When you switch it back on, use **Recompute last 3 months** to restore the figures it stopped keeping.

| IMAGE 25 | The rules form — Late tracking, Scope and the top of Late settings

### Step 24  Set Office Hours and Grace

| Field | What it controls |
| **Grace minutes** | How many minutes after office start someone can still arrive on time |
| **Office start** | Typed as HH:MM, for example 09:30 |
| **Office end** | Must be after office start |
| **Daily paid hours** | Filled in from the office hours, and meant to be typed over |

Start 09:30 with 15 grace minutes means anyone in by 09:45 is on time. **Daily paid hours** fills itself in when you change the hours: 09:30–18:30 spans 9 hours, but only 8 are paid if lunch is unpaid, so type 8.

> IMPORTANT  Late minutes are counted from office start, not from the end of grace. Start 09:30, grace 15: arriving at 09:50 shows 20 minutes late, not 5.

| IMAGE 26 | The Late settings and Office hours sections

### Step 25  Set the Day Status Ladder

Three rules decide each day's label. Each one ships switched off — 00:00, or 0 for the ratio — and with all three off nobody is ever marked **Half Day** or automatically **Absent**, and a late arrival stays **Late** however late they come.

| Field | What it controls |
| **Late window ends** | When the Late period ends. Check in after this and the day shows **Present**, with the real arrival time in brackets. No check-in at all by this time on a working day means **Absent**, stamped automatically |
| **Half day after** | Check in after this time and the day becomes a **Half Day** |
| **Half day below ratio** | A fraction of the daily paid hours between 0 and 1; 0.5 means half. Check out having worked less than this share and the day becomes a **Half Day** |

**Half day after** is checked first. If it is earlier than **Late window ends**, anyone arriving between the two is marked **Half Day**, not **Late**.

Tap **How a day gets its label** to unfold the full ladder, and the money that goes with each rung.

| What happened | Label | What it costs |
| In by office start plus grace | **Present** | Nothing |
| In after that, before the late window ends | **Late** | Nothing — recorded, never charged |
| In after the late window ends | **Present** | Nothing; the arrival time is shown in brackets |
| In after **Half day after**, or worked less than the ratio | **Half Day** | Half a day's pay |
| Never checked in on a working day | **Absent** | The day is simply not earned |

A further switch at the foot of this section lets a linked work-tracking app create the check-in when someone starts their workday there. It does nothing unless that link is installed on the server.

> IMPORTANT  Until **Late window ends** is set, absentees are never stamped: **Day Status** and **Absent Today** stay empty for people who did not come in.

| IMAGE 27 | The Day status ladder section with Late window ends, Half day after and Half day below ratio

### Step 26  Tick the Working Days and Save

**Working days** is a row of seven letters, Monday to Sunday. Green days are working days. Unticked days are days off: nobody is marked **Absent** on them, and they are left out of the working-day count that the monthly wage is divided by. At least one day must be ticked.

Tap **Save**. The app checks every field first and tells you what to fix.

| If you see this | What is wrong |
| **Use HH:MM, e.g. 09:30.** | A time is not in hours and minutes |
| **The office cannot end before it starts.** | Office end is before office start |
| **Outside office hours, so it would never apply.** | A ladder time falls outside the office day |
| **A fraction between 0 and 1 — 0.5 is half a day. 0 switches it off.** | The ratio was typed as a percentage |
| **Pick at least one working day — zero would break every daily rate.** | No working day is ticked |

A good save shows **Attendance rules updated.** Saving a rule change re-grades the last 3 months of attendance, so old records follow the new rules.

**Recompute last 3 months** does the same re-grading on demand. It asks **Recompute 3 months?** and confirms with **Late and leave figures recomputed for the last 3 months.** You rarely need it — mostly after switching late tracking back on.

| IMAGE 28 | Working days, the Save button and Recompute last 3 months

### Step 27  Look Through the Public Holidays

Tap **Public Holidays** (**Excluded from working days**) and pick a year with the arrows.

Each row shows the date, the holiday's name, the weekday and the company. **Not counted** means the holiday is recorded but does not change payroll.

A holiday is always paid and nobody is marked **Absent** on it. That works because counted holidays leave the working-day count the monthly wage is divided by, so every holiday you add raises everybody's daily rate for that month.

| IMAGE 29 | Public Holidays — the year arrows, one holiday and the Add a holiday button

### Step 28  Add, Edit or Remove a Holiday

Tap **Add a holiday**, or tap a holiday to edit it.

| Field | What it controls |
| **Holiday name** | Required — **Give the holiday a name.** |
| **Date** | The day itself, chosen from a calendar |
| **Company** | Which company it applies to; usually filled in for you |
| **Counts as a non-working day** | On, it leaves the working-day count and raises the daily rate for that month. Off records the date without touching payroll |

Tap **Add holiday** or **Save changes**. You will see **Holiday added.** or **Holiday updated.**

**Remove holiday** asks **Remove this holiday?** and warns that this changes payroll: the day goes back into the working-day count, which lowers everyone's daily rate for that month. Tap **Remove** to confirm; you will see **Holiday removed.**

| IMAGE 30 | Add holiday with the Date calendar open

### Step 29  Set Auto-Approval

Tap **Auto-Approval** (**Leave and WFH, one policy**). One screen covers both, but the two switches are independent.

| Field | What it controls |
| **Auto-approve leave** | Approve a pending leave request automatically once it has waited this long |
| **Auto-approve WFH** | The same, for work-from-home requests |
| **Wait** | How long a request may wait, shown when its switch is on |
| **Unit** | **Minutes**, **Hours** or **Days** |

With either switch on, an amber note warns that requests left undecided for the delay are approved by the server without anyone looking at them. Tap **Save**; you will see **Auto-approval updated.**

> IMPORTANT  A wait of 0 switches auto-approval off, whatever the switch says. Save one that way and the app tells you so, for example **Saved, but a wait of zero leaves leave auto-approval switched off.**

| IMAGE 31 | Auto-Approval — the Leave and Work from home switches, with Save and Cancel

# PART 8   EMPLOYEE DETAILS

### Step 30  Choose What Employee Details Are Kept

Tap **Field Settings** (**What My Details shows**). **Everyone (defaults)** decides which employee details are recorded for all staff. An **Exception** row applies to one employee and replaces the defaults for them — it is not merged with them. Each row counts how many fields are on, for example **12 of 21 shown**.

Tap a row. The form has five sections — **Salary**, **Statutory**, **Bank**, **Personal** and **Employment** — each with a master switch such as **Show the personal section**. With a section on, switch the individual fields underneath.

| Section | Fields inside it |
| **Salary** | **Salary effective from**, **Annual CTC**, **Salary payment mode** |
| **Statutory** | **Income tax regime**, **Professional tax state** |
| **Bank** | **IFSC code**, **Branch**, **Account category** |
| **Personal** | **Blood group**, **Father's name**, **Mother's name**, **Emergency contact relationship**, **Second emergency contact** |
| **Employment** | **Confirmation date**, **Notice period**, **Previous employment** |

Tap **Save**; you will see **Field settings updated.**

> IMPORTANT  In the app, an employee's **My details** shows only personal details, qualifications and previous employment. Salary, bank and statutory details never appear there whatever these switches say; those switches govern the web console.

> TIP  Rows are not created in the app. If the list says **Nothing configured**, or you need a new exception for one person, set it up on the web console first.

| IMAGE 32 | Field Settings with nothing configured yet

### Step 31  Build the Salary Components

Tap **Salary Components** (**Earnings and deductions**). Earnings add up to the gross; deductions come off it to give the net.

Each row shows the component's name, its code and how it is worked out — for example **BASIC · Fixed amount** — with an **Earning** or **Deduction** chip and the amount or percentage.

> IMPORTANT  An employee's earnings must add up to their Monthly Wage. If they do not, their payslip is flagged **Mismatch** and the payroll run cannot be confirmed.

| IMAGE 33 | Salary Components — earning and deduction rows and the Add a component button

### Step 32  Add or Change a Component

Tap **Add a component**, or tap a row to edit it.

| Field | What it controls |
| **Name** | Required — **Give the component a name.** |
| **Code** | A short code in capitals, such as BASIC or HRA |
| **Type** | **Earning** or **Deduction** |
| **Computation** | **Fixed amount**, **Percentage of another component** or **Percentage of gross** |
| **Default amount** | For a fixed amount |
| **Percentage** | Between 0 and 100, for either percentage |
| **Percentage of** | The component it is a percentage of |
| **Company** | Required |
| **Sequence** | The order components are listed in on the payslip |

Only a deduction can be a percentage of gross; an earning set that way gives **Only a deduction can be a percentage of gross.**

Tap **Add component** or **Save changes**. **Remove component** asks **Remove this component?**: any employee whose pay structure uses it loses that line, but payslips already generated are not changed.

| IMAGE 34 | Add component — Name, Code, Type, Computation and amount

### Step 33  Set the Statutory ID Types

Tap **Statutory ID Types** (**PAN, Aadhaar, UAN**). Each row is one kind of identity number, with its code (or **No code**), **validated** when it carries a pattern, and **Required** and **Confidential** chips.

Tap **Add an identifier type**, or tap a row.

| Field | What it controls |
| **Name** | Required |
| **Code** | A short code in capitals |
| **Company** | Required |
| **Sequence** | The order they are listed in |
| **Validation pattern** | A pattern the value must match; empty accepts anything |
| **Message when it fails** | What the employee is told when the value does not match |
| **Required** | Every employee must have this identifier on file |
| **Confidential** | Kept off screens that are not the employee's own; on by default |

A broken pattern is caught before saving with **That is not a valid regular expression.** Tap **Add identifier** or **Save changes**. **Remove identifier** asks **Remove this identifier type?**: employees who already hold one keep it, but nobody can be asked for it again.

> TIP  Statutory numbers never show on an employee's **My details** screen in the app.

| IMAGE 35 | Statutory ID Types — rows with their Required and Confidential chips

# PART 9   PAYROLL AND REPORTS

### Step 34  Create a Payroll Run

Tap **Payroll Runs** (**Generate, confirm, mark paid**). There is one run per company per month. Each row shows the month, the run's reference and employee count, a **Draft**, **Confirmed** or **Paid** chip, and the total net.

Tap **New payroll run**. Pick the **Month**, type the **Year** and choose the **Company**, then tap **Create**. The period and reference are set by the server from the month and year.

You will see **Payroll run created. Generate the payslips next.** and the new run opens. A month that already has a run for that company is refused with, for example, **A run already exists for September 2026.**

| IMAGE 36 | The New payroll run card — Month, Year, Company, Cancel and Create

### Step 35  Generate, Confirm and Pay

The run shows its company and state, then **Period**, **Pay date**, **Employees**, **Gross earnings**, **Deductions** and **Net pay**, and a **Payslips** row with the count. Which buttons appear depends on the state.

| What you tap | When it is offered | What happens |
| **Generate payslips** | **Draft**, no payslips yet | Builds one payslip per employee from attendance and salary |
| **Generate again** | **Draft** | Recalculates every payslip; anyone who has left the company loses theirs |
| **Confirm run** | **Draft** with payslips | Locks the payslips to these figures. You see **Run confirmed.** |
| **Back to draft** | **Confirmed** | Reopens the run so the payslips can be regenerated |
| **Mark paid** | **Confirmed** | Marks the money as gone out. You see **Run marked paid.** |

Every button asks you to confirm first.

If any payslip's earnings disagree with that employee's Monthly Wage, an amber note lists each one with both figures, and the run cannot be confirmed until they match. Fix the salary components and generate again.

> IMPORTANT  **Mark paid** cannot be undone. A paid run can never be reopened, because the payslips have been given to employees. Payslip PDFs are not produced in the app; print them from the web console.

| IMAGE 37 | A draft run — the totals, the Payslips row, Generate again and Confirm run

| IMAGE 38 | A confirmed run offering Mark paid and Back to draft

### Step 36  Read a Payslip

Tap **Payslips** on a run for that month's payslips, or **Payslips** on the menu for every payslip in every run. Each row shows the employee, department, paid days and net pay, with a **Mismatch** chip where the earnings disagree with the Monthly Wage.

Tap a payslip for the full breakdown. It is read-only; to change it, generate the run again.

| Section | What it shows |
| **Earnings** | Every earning line, then **Gross earnings** |
| **Deductions** | Every deduction line, then **Total deductions** |
| **NET PAY** | The amount paid, in figures and in words |
| **Attendance** | **Working days**, **Present**, **Half days**, **Absent**, **Paid leave**, **Unpaid leave**, **Loss of pay days** and **Paid days**, plus **Comp off** when there is any |
| **Leave balance** | **Opening**, **Taken** and **Closing** for the month |

| IMAGE 39 | A payslip — Earnings, Deductions, NET PAY and the start of Attendance

### Step 37  Generate a Month's Report

Tap **Generate Report** (**A month, per employee**).

| Field | What it controls |
| **Month** and **Year** | The month to report on |
| **Company** | Which company |
| **Department** | One department, or **All departments** |
| **Employees** | **All employees** or **Selected employees** |
| **Which employees** | The people to include, when **Selected employees** is chosen |

Picking employees by name ignores the department filter. **Selected employees** with nobody picked gives **Pick at least one employee, or switch to All.**

Tap **Generate**. It recalculates the whole month for everyone in scope, so it takes a moment. You will see **Report generated.**, the report opens, and it is saved under **Past Reports**.

> TIP  PDF and Excel exports of the report are made from the web console, not in the app.

| IMAGE 40 | Generate Report — Period, Scope and the Generate button

### Step 38  Read and Recalculate a Report

The report opens on **Grand totals**: **Period**, **Wage**, **Leave deduction**, **Total deduction** and **Final amount**, with a chip counting the employees.

Under **PER EMPLOYEE**, each row shows present over working days — for example **0/26 days** — then any late, unpaid and comp-off days, the final amount, and the deduction in red.

Tap an employee for their day-by-day lines. Each card is one line the report captured: a day, a late record or a leave, with empty values left out.

**Recalculate** refreshes the figures from current attendance; you will see **Report recalculated.**

| IMAGE 41 | A report — Grand totals, one employee row and Recalculate

| IMAGE 42 | One employee's day-by-day lines

### Step 39  Open a Past Report

Tap **Past Reports** (**What was generated before**). Each row is one saved report, with its month, department and company, and its final amount. Tap one to open it, and **Recalculate** to bring it up to date. An empty list says **No reports yet**.

| IMAGE 43 | Past Reports before any report has been generated

# QUICK REFERENCE

## Where Things Live

| To do this | Go here |
| See who is missing today | **Config** → **Absent Today** |
| See every late check-in | **Config** → **Late Records** |
| See how each day was graded | **Config** → **Day Status** |
| Rank late days for a month | **Config** → **Monthly Summary** → **Generate** |
| Approve or reject leave | **Config** → **All Leave Requests** |
| Decide a leave cancellation | **All Leave Requests** → **Cancellation** |
| See what leave was granted | **Config** → **Approved Leaves Report** |
| Add a comp-off credit by hand | **Compensatory Off** → **Add a credit** |
| See anyone's leave balance | **Config** → **Leave Balances** |
| Change paid days or comp-off expiry | **Config** → **Leave Policy** |
| Approve or reject work from home | **Config** → **All WFH Requests** |
| Change office hours or grace | **Office Hours & Working Days** → tap a card |
| Switch on automatic Absent | **Office Hours & Working Days** → **Late window ends** |
| Add a public holiday | **Public Holidays** → **Add a holiday** |
| Auto-approve waiting requests | **Config** → **Auto-Approval** |
| Choose which employee details are kept | **Config** → **Field Settings** |
| Change the pay structure | **Config** → **Salary Components** |
| Run the month's payroll | **Payroll Runs** → **New payroll run** |
| Report on a month | **Config** → **Generate Report** |

## Who Can Do What

| Task | Employee | HR | Admin |
| See the Config tab | No | No — gets the HR tab | Yes |
| See who is absent today | No | Yes, on the HR tab | Yes |
| Approve or reject leave | No | Yes | Yes |
| Decide a leave cancellation | No | Yes | Yes |
| Approve or reject work from home | No | Yes | Yes |
| Late Records, Day Status, Monthly Summary | No | No | Yes |
| Comp-off credits and leave balances | No | No | Yes |
| Leave Policy and Auto-Approval | No | No | Yes |
| Office hours, ladder and holidays | No | No | Yes |
| Field settings, salary components, statutory IDs | No | No | Yes |
| Payroll runs and reports | No | No | Yes |

An administrator sees each section only when their login carries the right behind it; a missing section is a missing right, not a fault.

## Things to Remember

- **Being late costs nothing.** A **Half Day** is the only pay cut, an **Absent** day is simply not earned, and days off and holidays are always paid.
- **The ladder ships switched off.** Until you set **Late window ends**, nobody is ever stamped Absent.
- **Holidays raise the daily rate.** A counted holiday leaves the working-day count the monthly wage is divided by; removing one lowers it.
- **New rule sets are made on the web console.** The app edits the office-hours rules that already exist.
- **Saving the rules re-grades three months.** Old records follow the new rules.
- **Policy changes apply from now on.** Leave already decided keeps its paid and unpaid split.
- **Paid leave does not carry forward.** Comp off can, up to the cap you set.
- **A wait of zero switches auto-approval off**, whatever the switch says.
- **Earnings must match the Monthly Wage**, or the payroll run cannot be confirmed.
- **Mark paid is final.** A paid run can never be reopened.
- **Cancelling approved leave stops at payroll.** It is refused once that month's run is confirmed or paid.
- **Payslip PDFs and report exports come from the web console**, not the app.
- **My details never shows salary, bank or statutory details**, whatever Field Settings says.

=== Set the rules once, clear the red badges every morning, and close each month's payroll. Everything else in this guide supports those three.

@@ END
