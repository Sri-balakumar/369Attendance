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

%% BOOK: Employee Guide | Check in, check out, and ask for the days you need.

## About This Guide

This is the guide for everyone who uses 369 Attendance, from Alphalize Technologies, to record their own working day: checking in and out, working on a day off, applying for leave, asking to work from home, and looking back over the month.

It describes the app exactly as it behaves on the phone. Every button name, field label and message in this guide is quoted from the app itself, so what you read here is what you will see on the screen.

HR staff and administrators use this guide too. Their own attendance, leave and work-from-home days work exactly as they do for everyone else. What they approve and configure is covered in two separate documents, the HR Guide and the Administrator Guide.

> TIP  HR staff and administrators see a third tab in the middle of the bar along the bottom, labelled **HR** or **Config**. Everything in this guide happens on the other two tabs, **Home** and **Profile**, which look the same for everyone.

## 369 Attendance at a Glance

- **Once** — connect the phone to your company's server and sign in. The app remembers both.
- **Every working day** — tap **Check In** when you start and **Check Out** when you finish.
- **On a weekly off or holiday you work** — tap **I'm working today** first, then check in; the day earns you a compensatory off.
- **When you need time away** — open **Apply Leave**, pick the dates, give a reason, and read any red Loss of Pay warning before you submit.
- **When you want to work from home** — open **Work From Home**, request the day, and check in as usual once it is approved.
- **Whenever you like** — look back over **My Attendance** and check **My Details**.

# PART 1   GETTING STARTED

### Step 1  Connect to Your Company's Server

The app opens on a short splash screen showing **369 Attendance**, **Attendance, leave & WFH in one place** and **by Alphalize Technologies**. The very first time, it then asks where your company's server is.

The screen is headed **Connect to your server** and marked **STEP 1 OF 2**. Type the address your HR team gave you into **Server URL**. You do not need to press anything: once the address looks complete the app shows **Fetching databases…** and looks up the databases on that server by itself.

If the server has only one database, it is chosen for you and you will see **1 database found · selected automatically**. If there are several, tap **Database** (it reads **Select a database** until you choose) and pick yours from the **Select database** list. Then tap **Continue**.

If you leave off the http:// or https:// at the start, the app adds the right one for you: plain http for an address on your office network, https for anything else.

| What you see | What it means |
| **Databases load automatically once the address looks complete.** | Keep typing; nothing has been looked up yet |
| **No databases found on this server.** | The address answered but there is nothing to sign in to. Check the address with HR |
| **This server does not publish its database list. Enter the database name manually below.** | Tap **Enter database manually** and type the name HR gave you into **Database name** |
| **Cannot reach the server.** | The phone could not reach that address. Check it, and check the phone is on the right network |
| **Retry** | Asks the server again without retyping |

> TIP  **Your server address is stored on this device only.** You are asked for it once. After that the app goes straight to the sign-in screen, or straight to Home if you are already signed in.

| IMAGE 1 | The server screen — Server URL, the database found for you, and Continue

### Step 2  Sign In

The sign-in screen says **Welcome back** and **Sign in to continue**, and is marked **STEP 2 OF 2**. At the top, a strip shows the server and database you are about to sign in to.

Type your **Username** and **Password** and tap **Sign In**. The eye at the end of the password box shows what you have typed.

| If you see this | What to do |
| **Username is required** or **Password is required** | Fill in the empty box |
| **Invalid username or password.** | Check both and try again; passwords are case-sensitive |
| **Contact your HR administrator to reset your password.** | This is what **Forgot password?** tells you. There is no reset inside the app |
| **No employee record is linked to your user account. Please contact HR.** | You signed in, but HR has not yet linked your login to an employee. Home cannot load until they do |

| IMAGE 2 | The sign-in screen — the server strip with Change URL, Username, Password and Sign In

### Step 3  Stay Signed In, Log Out, or Change Server

**You stay signed in until you log out.** Closing the app, restarting the phone or coming back days later all return you straight to Home.

To sign out, tap the log-out button at the far right of the Home header. The app asks **Log out?** — **You will need to enter your username and password again. The server and database stay saved.** Tap **Log out** to confirm.

To point the app at a different server, sign out first, then tap **Change URL** in the strip at the top of the sign-in screen. It asks **Change server?** — **You'll be signed out and asked for the server URL and database again.** Tap **Change server** and you are back at Step 1.

| What you tap | What it clears |
| **Log out** | Your sign-in only. Next time you type your username and password; the server is remembered |
| **Change URL**, then **Change server** | Your sign-in and the server. Next time you start again from Step 1 |

> IMPORTANT  If you ever see **Your session has expired. Please sign in again.**, log out and sign back in. Nothing you saved is lost.

| IMAGE 3 | The Log out? confirmation over Home, with Cancel and Log out

# PART 2   YOUR HOME SCREEN

### Step 4  Find Your Way Around Home

Home opens with a greeting — **Good morning**, **Good afternoon** or **Good evening** — and your name. Under it is today's date.

Four round buttons sit at the top right.

| What you tap | What happens |
| Moon or sun | Switches between the dark and light look. The app always opens light again next time |
| Bell | Shows **No new notifications.** The app has no notifications yet, so the small dot on the bell is always there and means nothing |
| Gear | Opens **Settings**, which shows the server you are connected to (Step 24) |
| Log-out arrow | Asks **Log out?** (Step 3) |

Below the header is the attendance card: a live clock, a status chip, your **Check In** and **Check Out** times for today, and one big button. Under the card, a line gives your office rules, for example **Office 08:00–17:00 · 15 min grace**.

Pull the screen down at any time to refresh everything on it.

> TIP  Pressing the phone's back button on Home does nothing. That is deliberate, so a stray press never closes the app halfway through your day.

| IMAGE 4 | Home on an ordinary working day — the greeting, the four header buttons, and the attendance card showing Not checked in

### Step 5  Check In and Check Out

When you arrive, tap **Check In**. The app confirms with **Checked in. Have a productive day!** The chip changes to **Checked in** with a running timer, your arrival time fills in under **Check In**, and the button turns red and reads **Check Out**.

When you finish, tap **Check Out**. The app confirms with **Checked out. Have a good evening!** The chip reads **Done for today** and the button greys out as **Checked out for today**.

There is nothing else to do: no photo, no location, no reason to type. The server grades the day from your check-in time against your office hours. Arrive after the grace period and the day is marked **Late**; the app does not stop you or ask why.

| What the chip says | What it means |
| **Not checked in** | You have not started today |
| **Checked in** · time | You are in; the figure counts your time since check-in |
| **Done for today** | You have checked out. Today is closed |
| **WFH** | Today is an approved work-from-home day (Part 5) |

> IMPORTANT  There is no "are you sure?" on **Check Out**. One tap closes your day, and once you have checked out you cannot check in again until tomorrow. If you are only stepping out, do not check out.

| IMAGE 5 | Checked in — the green Checked in chip with its timer, the check-in time, and the red Check Out button

### Step 6  Read Today's Figures and the Month

Three tiles sit under the attendance card.

| Tile | What it shows |
| **Worked** | Hours worked today, such as **0h 00m** |
| **Status** | How the server has graded today: **Present**, **Late**, **Half Day**, **Leave**, **Absent** or **Day Off**. Until the day has a grade it simply reads **Present** |
| **Late by** | **On time**, or how late you were |

Below them, a card headed with the month and year counts this month's **Present**, **Late**, **Absent** and **Leave** days.

At the bottom, **Recent activity** lists your most recent graded days this month, up to ten, each with its date, the in and out times, the hours worked and a status chip. Until you have checked in at least once it says **No check-ins yet** and **Your last five days show here once you check in.**

| IMAGE 6 | Home further down — the three tiles, the month card, Quick actions and Recent activity

### Step 7  Use the Quick Actions and the Tabs

The four **Quick actions** tiles take you to everything else in the app.

| What you tap | Where it goes |
| **Apply Leave** — **Casual · Sick · Earned** | Your leave (Part 4) |
| **Work From Home** — **Request a WFH day** | Your work-from-home requests (Part 5) |
| **My Attendance** — **Day-wise history** | Your month, day by day (Step 22) |
| **My Details** — **Your profile** | The **Profile** tab (Step 23) |

Along the bottom of Home and Profile floats a bar with two tabs, **Home** and **Profile**. The tab you are on is filled in amber. Leave, Work from home, My attendance and Settings open on top of Home and cover the bar; the arrow at their top left, or the phone's back button, brings you back.

> TIP  The **Apply Leave** tile says **Earned**, but there is no leave type by that name. The nearest one on the form is **Annual**.

# PART 3   WORKING ON A DAY OFF

### Step 8  Spot a Day Off

On your weekly off, an amber pill beside the date reads **Weekly off**. On a public holiday it shows the holiday's name followed by **· holiday**.

If your company requires it, the attendance card changes on these days. The chip reads **Day off · not declared**, a three-part bar appears — **1 Declare**, **2 Check in**, **3 Check out, earn** — and the big button reads **I'm working today** instead of **Check In**. The line under it tells you how the day is paid back, for example **Check-in opens after you declare. Under 4.5 h earns ½ day, 4.5 h or more earns 1 day.**

The server will not accept a check-in on these days until you have declared that you are working.

> TIP  If the pill appears but the card still shows an ordinary **Check In** button, your company does not ask for the declaration. Check in as normal.

| IMAGE 7 | Home on a weekly off — the Weekly off pill, the Day off · not declared chip, the three-step bar and I'm working today

### Step 9  Declare That You Are Working

Tap **I'm working today**. The app asks **Working today?** and explains, for example, **Today is your weekly off. Check-in opens for today, and your hours earn a comp-off: under 4.5 h is half a day, 4.5 h or more is a full day.**

Tap **I'm working today** again to confirm. The app answers **Marked as a working day. You can check in now.**, the chip changes to **Working today · declared** and the first part of the bar fills.

| What you tap | What happens |
| **I'm working today** on the card | Opens the confirmation |
| **I'm working today** in the window | Declares the day and opens check-in |
| **Cancel** | Leaves the day as a day off |

| IMAGE 8 | The Working today? window with Cancel and I'm working today

### Step 10  Check In, or Change Your Mind

Once declared, the button reads **Check In** and the line under it says **Declared. Check in when you start.** Tap **Check In** when you begin work, exactly as on any other day.

Changed your plans? Until you check in, a link under the button reads **Not working after all**. Tap it and the declaration is withdrawn; the app says **Enjoy your day off.** Once you have checked in, the link disappears.

> TIP  A declaration you never use costs nothing. If the day passes without a check-in, the server drops it and it earns nothing.

| IMAGE 9 | Declared — Working today · declared, the Check In button, and the Not working after all link

### Step 11  Check Out and Earn Your Comp-Off

While you are checked in, the line under **Check Out** reminds you of the full-day mark, for example **Check out after 4.5 h for a full comp-off day.**

When you check out, the server works out what the day earned from the hours you actually worked: below the mark earns half a day, the mark or more earns a full day. For a moment the card may say **Comp-off is being sized from your hours.**; then it reads **Earned ½ day of comp-off.** or **Earned 1 day of comp-off.**

The day shows as **Day Off** in your records. It is never counted against you, and the comp-off it earned appears on your Leave screen (Step 12).

| What the line says | What it means |
| **Check out after 4.5 h for a full comp-off day.** | You are checked in; stay to the mark for a full day |
| **Comp-off is being sized from your hours.** | You have checked out; the server is still working it out |
| **Earned ½ day of comp-off.** | You worked less than the full-day mark |
| **Earned 1 day of comp-off.** | You reached the full-day mark |

| IMAGE 10 | Checked in on a declared day off, with Check out after 4.5 h for a full comp-off day.

| IMAGE 11 | Done for today, with Earned ½ day of comp-off. under the greyed Checked out for today button

# PART 4   LEAVE

### Step 12  Open Leave and Read Your Balances

Tap **Apply Leave** on Home. The **Leave** screen (**Apply, track and cancel**) shows your balances at the top and your requests underneath.

The **Paid leave** card shows three figures for this calendar year.

| What you see | What it means |
| **Remaining** | Paid days you still have this year |
| **Used** | Paid days already taken |
| **Allowed** | Your allowance for the year |
| **Used counts approved leave only** | Pending requests are not in **Used** yet; the line adds how many more are **pending approval** |
| **1 day/month accrual** | How your allowance builds up, if your company sets one |
| **Days beyond your quota are unpaid.** | Leave past your allowance is Loss of Pay |

Two red lines warn you before you apply that your next leave will be unpaid: **This month's paid leave is used. More leave this month is unpaid (LOP).** or **Paid leave exhausted. New leave is unpaid (LOP).** If your company has no paid-leave allowance at all, the card simply says **No paid-leave quota is configured. You can still apply for leave.**

The **Compensatory off** card shows the days you have earned by working days off: **Available**, **Used** and **Earned**. With nothing earned yet it says **None yet. On a weekly off or public holiday, tap "I'm working today" on Home and the day earns one.** If your company does not use comp-off, the card is not shown at all.

> IMPORTANT  Paid leave does not carry forward. Each calendar year starts again from your allowance, and unused days do not move across. Comp-off works differently: whether it carries into the next year, and whether it expires, is set by your company.

| IMAGE 12 | The Leave screen — the Paid leave and Compensatory off cards above the filter chips and the Apply for leave button

### Step 13  Fill In a Leave Request

Tap **Apply for leave** at the bottom of the screen. The **Apply for leave** form slides up.

Choose a **Leave type**. The list is fixed: **Casual**, **Sick**, **Annual**, **Personal**, **Emergency** and **Other**, plus **Comp-off** when you have some to spend (Step 15). **Casual** is chosen for you to start.

Tap **Dates**. A small calendar opens: **Tap the first day, then the last**. For a single day, tap it once. Tapping a day earlier than your first one starts again from there. Today is outlined, and the key at the bottom shows **Holiday** and **Weekly off** so you can see the days you already have off. Tap the button at the bottom — it reads **Use** and the dates you chose — to fill in the form. **Cancel** leaves the form as it was.

Type a **Reason**, then tap **Submit request**. The app says **Leave request submitted.** and the request appears in your list as **Pending**.

| If you see this | What it means |
| **Pick at least a start date.** | Choose your dates first |
| **Give a reason for your leave.** | The reason is required |
| **These dates overlap an existing request.** | You already have leave on some of these days; the red box below explains which |

> TIP  The day count shown under **Dates** simply counts calendar days, weekends included. The server counts working days when it decides what is paid, and the red warning in the next step always uses its figure.

> IMPORTANT  Paid leave is taken in whole days. The **Half day** switch appears only for **Comp-off**.

| IMAGE 13 | The Apply for leave form — the Leave type chips with Casual chosen, Dates, Reason and Submit request

| IMAGE 14 | The date calendar — Tap the first day, then the last, with the Holiday and Weekly off key

### Step 14  Read the Loss of Pay Warning

As soon as you pick your dates, the server works out how much of the leave it will pay. If any of it would be unpaid, a red box appears at the top of the form, and the submit button tells you how much, for example **Submit · 1 day unpaid (LOP)**.

The box reads one of these:

| What the box says | What it means |
| **Only** … **of these** … **is paid leave. The other** … **will be Unpaid Leave / Loss of Pay (LOP).** | Part of this leave is paid, the rest is not |
| **Your paid leave for this month** (…) **is already used. Any additional leave applied this month will be treated as Unpaid Leave / Loss of Pay (LOP).** | You have reached this month's limit |
| **Your paid leave balance has already been exhausted. Any additional leave applied will be treated as Unpaid Leave / Loss of Pay (LOP).** | Your allowance for the year is gone |
| **Paid leave is not set up for your company, so this leave will be Unpaid Leave / Loss of Pay (LOP).** | Your company has no paid-leave allowance |

Where your company deducts unpaid days from salary, the box adds **and deducted from your salary**.

> IMPORTANT  The warning never stops you. Unpaid leave is a legitimate request and you can still submit it. The box is there so that you find out now, not from your payslip.

| IMAGE 15 | A one-day Casual request that is half unpaid — the red box and Submit · Half day unpaid (LOP)

| IMAGE 16 | The warning when this month's paid leave is already used, with Submit · 1 day unpaid (LOP)

### Step 15  Spend a Comp-Off

When you have comp-off available, a **Comp-off** chip joins the leave types with your balance beside it. Choose it.

A panel appears saying **Pick a date to see which earned days it uses**. Once you pick dates it changes to **Paid from your earned days, oldest first** and lists each day you worked that will pay for this leave, with how much of it is used. You do not choose these; the app picks the oldest first. Anything left over is shown as, for example, **½ day kept for later.**

Turn on **Half day** — **Spend ½ day of comp-off on one date** — to take half a day. The field then reads **Date** and takes a single day.

The submit button tells you what it will use, for example **Submit · uses ½ day**. No paid leave is spent.

| If you see this | What to do |
| **This needs** … **but you have** … **of comp-off. Pick fewer days or turn on Half day.** | You do not have enough; the button stays greyed until you change the dates |
| **Those dates are already days off, so there is nothing to take.** | Pick working days instead |

| IMAGE 17 | Comp-off chosen with Half day on — the earned day it uses, the date, and Submit · uses ½ day

### Step 16  Preview the Email to HR

If your company emails HR when leave is submitted, a **Preview email to HR** button appears on the form above the submit button.

Tap it to see the **Email to HR** exactly as HR will receive it, built from what you have typed so far. A line at the top says how many people it goes to, for example **Goes to 2 people in HR when submitted.** The **Review and approve** button inside the preview is only a picture of the email; it does nothing here. Tap **Close** to return to the form.

If the button is not on your form, your company does not send these emails. Your request still reaches HR in the app.

| IMAGE 18 | The Email to HR preview — the recipient line, the email on white paper, and Close

### Step 17  Track Your Requests

Every request you make appears on the **Leave** screen, newest first. Each card shows the leave type, the dates and how many days, a status chip, and your reason.

| Status | What it means |
| **Pending** | Waiting for HR |
| **Approved** | Granted. The line below says **Approved by** and a name, or **Auto-approved** |
| **Rejected** | Refused. HR's reason is shown in red, or **No reason given.** |
| **Cancelled** | Withdrawn by you, or cancelled by HR at your request |

A comp-off request also shows **Uses the day you worked:** and the date that pays for it.

The chips across the top — **All**, **Pending**, **Approved**, **Rejected** and **Cancelled** — narrow the list. If nothing matches you will see, for example, **No pending requests** and **Show all**.

> TIP  The list holds your most recent 50 requests. When it is full, a line at the bottom says **Showing the 50 most recent requests.** Use the chips to find older ones.

| IMAGE 19 | The request list — a pending Casual request and a pending Compensatory Off, each with Cancel request

### Step 18  Cancel a Pending Request

While a request is **Pending**, its card has a red **Cancel request** link. Tap it.

The app asks **Cancel this request?** — **Your** leave **for** the dates **will be withdrawn. You can apply again for the same dates afterwards.** Tap **Cancel request** to withdraw it, or **Keep it** to leave it alone. You will see **Leave request cancelled.**

| What you tap | What happens |
| **Cancel request** on the card | Asks you to confirm |
| **Cancel request** in the window | Withdraws it at once. HR does not need to agree |
| **Keep it** | Nothing changes |

| IMAGE 20 | The Cancel this request? window with Keep it and Cancel request

### Step 19  Ask HR to Cancel Approved Leave

Once leave is **Approved**, you cannot cancel it yourself. Instead its card has an orange **Request cancellation** link.

Tap it. The app asks **Ask HR to cancel this leave?** and explains that the leave **is already approved, so HR decides. It stays approved until they do.** Type why into **Why cancel it?** — it is required, and if you leave it empty you will see **Give a reason — HR sees this.** Then tap **Send to HR**. The app confirms with **Cancellation request sent to HR.**

The card now says **Cancellation requested · waiting for HR**. What happens next is HR's decision.

| What HR decides | What you see |
| They agree | The leave becomes **Cancelled** and its days go back to your balance |
| They keep it | The leave stays **Approved**, a red line reads **HR kept this leave:** and their reason, and **Request cancellation** is offered again |

> IMPORTANT  Once payroll for the month the leave falls in has been confirmed or paid, the leave can no longer be cancelled. The app shows a message saying the payroll for that period is already confirmed or paid. Talk to HR directly.

| IMAGE 21 | Ask HR to cancel this leave? with a reason typed into Why cancel it?, and Keep it and Send to HR

| IMAGE 22 | After sending — Cancellation request sent to HR. and Cancellation requested · waiting for HR on the card

| IMAGE 23 | HR kept the leave — HR kept this leave: and the reason, with Request cancellation offered again

# PART 5   WORK FROM HOME

### Step 20  Request a WFH Day

Tap **Work From Home** on Home. The **Work from home** screen (**Request a day, track approvals**) lists your requests. Tap **Request a WFH day** at the bottom.

In the form, tap **Day** and pick a date from the calendar (**Pick a day**). A WFH day has to be approved before it is worked, so days before today are struck through and cannot be chosen. Type a **Reason** and tap **Submit request**. The app says **WFH request submitted.**

Each request is for one day. For several days, make one request for each.

| If you see this | What it means |
| **Pick the day you want to work from home.** | Choose the day first |
| **Give a reason for the request.** | The reason is required |
| **You already have a request for this day.** | There is already a request for that date; the red box below gives its status |

> TIP  As the form says, **Once approved, check in as usual on the day — there is no separate WFH button, and your location is not checked.** You use the same **Check In** and **Check Out** on Home. The app never reads your location on any day, WFH or not.

| IMAGE 24 | The Work from home form — Day, Reason, the check-in note and Submit request

### Step 21  Track and Cancel WFH Requests

Each card shows the date (with **Today** under it on the day itself), a status chip and your reason. Once you have worked the day, it also shows **In**, **Out** and **Worked**.

| Status | What it means |
| **Pending** | Waiting for HR |
| **Approved** | Granted; the line below says who approved it, or **Auto-approved** |
| **Working** | You are checked in on the WFH day |
| **Done** | You have checked out |
| **Rejected** | Refused, with HR's reason or **No reason given.** |
| **Expired** | Approved, but the day passed without a check-in |
| **Cancelled** | Withdrawn |

On an approved WFH day, a green box at the top of the screen reads **You are working from home today** and **Check in from the home screen as usual. Your location will not be checked.** Home shows a **WFH** chip on the attendance card.

To withdraw a request that is **Pending** or **Approved**, tap **Cancel request** on its card, then **Cancel request** again in the window (**Keep it** backs out). You will see **WFH request cancelled.** Once you have checked in on the day, it can no longer be cancelled.

The chips across the top are **All**, **Pending**, **Approved**, **Done** and **Rejected**. There is no chip for cancelled requests; they appear under **All**. The list holds your most recent 50.

| IMAGE 25 | The Work from home list — a pending request with Cancel request, and Request a WFH day at the bottom

# PART 6   YOUR RECORDS

### Step 22  Look Back at Your Attendance

Tap **My Attendance** on Home. **My attendance** (**Day-wise history**) opens on the current month.

The arrows either side of the month name step back and forward. The forward arrow stops at the current month, since nothing is recorded ahead of today.

A summary card counts the month's **Present**, **Late**, **Half Day**, **Leave**, **Absent** and **Day Off** days, and adds a line such as **0h 00m worked across 1 recorded day.**

Below it, one card per graded day shows the date, your in and out times, the hours worked, a **WFH** chip on work-from-home days, an amber line on days you were late, and the day's status chip. A month with nothing graded says **Nothing recorded**.

| What you see | What it means |
| **Present** | On time, full day |
| **Late** | Arrived after the grace period |
| **Half Day** | Graded as half a day |
| **Leave** | Covered by approved leave |
| **Absent** | Expected in, never checked in |
| **Day Off** | A weekly off or holiday you worked; never counted against you |

> TIP  This screen shows counts and times only. It never shows a money figure; questions about pay go to HR.

| IMAGE 26 | My attendance — the month arrows, the six-count summary, and a day card

### Step 23  Check Your Details

Tap the **Profile** tab, or **My Details** on Home. **My details** shows an **Account** card with your **Name** and **Username**.

Further sections appear only if HR has switched them on: **Personal** (blood group, parents' names and emergency contacts), **Qualifications** and **Previous employment**. A field HR has switched on but nobody has filled in shows a dash. If HR has switched nothing on, you will see **Nothing to show yet** and **Your HR team has not enabled any detail sections.**

Everything here is read-only. To change your details, use My Profile in the web console, or ask HR for anything not shown.

| What you see | What it means |
| A section with rows | HR has switched it on; the values come from your record |
| A dash in a row | That field is empty on your record |
| **Nothing recorded yet.** | A section is on, but nothing has been added to it |
| **Nothing to show yet** | HR has not switched on any sections |

| IMAGE 27 | My details — the Account card, and the note shown when no sections are switched on

### Step 24  See Which Server You Are On

Tap the gear at the top of Home. **Settings** (**Server and account**) shows one card, **Connection**, with four rows: **Server**, **Database**, **Signed in as** and **Username**.

Nothing here can be changed. It is there so you can read out exactly which server and account the phone is using when HR asks.

| IMAGE 28 | Settings — the Connection card with Server, Database, Signed in as and Username

# QUICK REFERENCE

## Where Things Live

| To do this | Go here |
| Start your day | Home → **Check In** |
| End your day | Home → **Check Out** |
| Work a weekly off or holiday | Home → **I'm working today** → **Check In** |
| Undo a day-off declaration | Home → **Not working after all** (before you check in) |
| See your leave balances | **Apply Leave** → **Paid leave** and **Compensatory off** cards |
| Apply for leave | **Apply Leave** → **Apply for leave** |
| Spend a comp-off | **Apply for leave** → **Comp-off** |
| Withdraw a pending request | The request's card → **Cancel request** |
| Cancel approved leave | The request's card → **Request cancellation** → **Send to HR** |
| Ask to work from home | **Work From Home** → **Request a WFH day** |
| See a past month | **My Attendance** → the month arrows |
| Check your personal details | **Profile** tab |
| See which server you are on | The gear on Home → **Settings** |
| Sign out | The log-out button on Home → **Log out** |
| Change server | Sign out, then **Change URL** on the sign-in screen |

## Things to Remember

- **One check-in and one check-out a day.** Once you check out, you cannot check in again until tomorrow.
- **Check Out has no confirmation.** Do not tap it until you are really leaving.
- **Declare a day off before you check in.** On a weekly off or holiday, tap **I'm working today** first, or the check-in will be refused.
- **The Loss of Pay warning never blocks you.** Read it before you submit; the server itself works out the figure.
- **Paid leave is whole days and does not carry forward.** Only comp-off can be taken as a half day.
- **Approved leave goes back through HR.** Use **Request cancellation**, and do it before that month's payroll is confirmed.
- **A WFH day uses the ordinary Check In.** There is no separate button, and the app never reads your location.
- **There is no offline mode.** Every check-in and request goes straight to the server, so you need a connection.
- **The bell does nothing yet.** It always says **No new notifications.**
- **Pull down to refresh.** Home, Leave, Work from home, My attendance and My details all update this way.
- **You stay signed in until you log out.** Logging out keeps the server; **Change URL** forgets it.

=== Check in when you start, check out when you finish, and ask for the rest. Everything else in this guide is detail.

@@ END
