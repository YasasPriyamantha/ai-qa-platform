# SauceDemo Requirements

## REQ-001: Login with valid credentials

Status: Active
Priority: Critical
Role: standard_user

### Description

A registered standard user can log in to SauceDemo using the valid username and password published on the login page.

### Expected result

After logging in with the standard user's credentials, the user is taken to `https://www.saucedemo.com/inventory.html` and the page shows the title `Products`.

### Negative cases

- Empty username: login is prevented and the message `Epic sadface: Username is required` is shown.
- Wrong password: logging in with the standard user's username and the password `wrong_password` is prevented and the message `Epic sadface: Username and password do not match any user in this service` is shown.
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

An authenticated standard user can add a product to the shopping cart from its product page.

### Expected result

After the standard user opens `/inventory-item.html?id=4`, the product page for `Sauce Labs Backpack`, and clicks `Add to cart` once, the cart badge displays `1`.
