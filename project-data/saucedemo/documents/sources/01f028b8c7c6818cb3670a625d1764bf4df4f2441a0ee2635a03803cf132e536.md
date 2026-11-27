# SauceDemo Requirements

## REQ-001: Login with valid credentials

Status: Active
Priority: Critical
Role: standard_user

### Description

A registered standard user can log in to SauceDemo using the valid username and password published on the login page.

### Expected result

After logging in with `standard_user` and `secret_sauce`, the user is taken to `https://www.saucedemo.com/inventory.html` and the page shows the heading `Products`.

### Negative cases

- Empty username: login is prevented and the message `Epic sadface: Username is required` is shown.
- Wrong password: login is prevented and the message `Epic sadface: Username and password do not match any user in this service` is shown.
- Locked-out user: login is prevented and the message `Epic sadface: Sorry, this user has been locked out.` is shown.


## REQ-002: Login page controls

Status: Active
Priority: High

### Description

The login page provides a username input, a password input and a control that submits the login form.

### Expected result

The page at `/` shows a username input with the placeholder `Username`, a password input with the placeholder `Password`, and a button with the accessible name `Login`.


## REQ-003: Add a product to the cart

Status: Active
Priority: High
Role: standard_user

### Description

An authenticated standard user can add a product from the products page to the shopping cart.

### Expected result

After the user clicks `Add to cart` for the `Sauce Labs Backpack` product once, the cart badge displays `1`.
