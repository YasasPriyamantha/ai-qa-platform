# Release Demo Requirements — V1

## DEMO-001: Display the login form

Status: Active
Priority: High

### Description

The Release Demo application provides a login page where a user can enter a username and password to access the task list.

### Expected result

The page at `/` shows the heading `Sign in to Release Demo`, a username field labelled `Username`, a password field labelled `Password`, and a button labelled `Sign in`.


## DEMO-002: Log in with the demo account

Status: Active
Priority: Critical
Role: demo_user

### Description

A user can access the task list by submitting the single configured demo account's valid credentials.

### Expected result

When the user enters the demo account's username and password and clicks `Sign in`, the application navigates to `/tasks.html` and displays the heading `My Tasks`.

### Negative cases

- Empty username: login is prevented, the page remains at `/`, and the message `Username is required.` is displayed.
- Empty password: login is prevented, the page remains at `/`, and the message `Password is required.` is displayed.
- Incorrect credentials: signing in with the demo account's username and the password `wrong-password` is prevented, the page remains at `/`, and the message `Username or password is incorrect.` is displayed.


## DEMO-003: Display the predefined task list

Status: Active
Priority: High
Role: demo_user

### Description

After a successful login, the task list page displays a small, predictable set of initial tasks.

### Expected result

The `/tasks.html` page displays all three task titles: `Prepare release notes`, `Review test results`, and `Approve deployment`.


## DEMO-004: Add a task with a required title

Status: Active
Priority: High
Role: demo_user

### Description

A signed-in user can add a task by entering a non-empty title in the task form.

### Expected result

The `/tasks.html` page shows a text field labelled `Task title` with the placeholder `Enter a task title` and a button labelled `Add task`. When the user enters `Check deployment logs` and clicks `Add task`, `Check deployment logs` appears in the task list.

### Negative cases

- Empty task title: no task is added and the message `Task title is required.` is displayed.
