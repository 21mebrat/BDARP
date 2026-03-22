export const rMessage = {
  // ── Auth & Session ────────────────────────────────────────────────────────
  not_authorized: "Please log in to continue.",
  invalid_token: "The authentication token is invalid.",
  token_expired: "Your session has expired. Please log in again.",
  invalid_credentials: "The email or password you entered is incorrect.",

  // ── Account State ─────────────────────────────────────────────────────────
  user_not_found: "No account was found with the provided details.",
  account_disabled: "Your account has been disabled. Please contact support.",
  email_not_verified: "Please verify your email address before continuing.",

  // ── Registration ──────────────────────────────────────────────────────────
  user_registered:
    "Your account has been created successfully. Please verify your email to get started.",
  user_already_exists:
    "An account with this username or email already exists. Please try a different one.",
  invalid_username:
    "Username must be 3–50 characters and may only contain lowercase letters, numbers, underscores ( _ ), hyphens ( - ), or dots ( . ).",
  invalid_email:
    "The email address provided is not valid. Please double-check and try again.",
  invalid_password:
    "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character.",
  invalid_url:
    "The website URL is not valid. Please provide a full URL starting with http:// or https://.",
  unknown_fields:
    "Your request contains unrecognized fields. Please review your input and try again.",
  role_not_found:
    "The assigned role could not be found. Please contact the system administrator.",

  // ── General ───────────────────────────────────────────────────────────────
  access_denied: "You do not have permission to perform this action.",
  resource_not_found: "The requested resource could not be found.",
  invalid_request: "The request is malformed or contains invalid data.",
  operation_failed: "The operation could not be completed. Please try again.",
  internal_server_error:
    "An unexpected error occurred on our end. Please try again later.",
  service_unavailable:
    "The service is temporarily unavailable. Please check back shortly.",
  request_timeout: "The request timed out. Please try again.",
  rate_limit_exceeded:
    "You have made too many requests. Please wait a moment before trying again.",

  // ── Login ─────────────────────────────────────────────────────────────────────
  login_success: "You have logged in successfully. Welcome back!",
  invalid_credentials:
    "The username/email or password you entered is incorrect. Please try again.",
  account_disabled:
    "Your account has been suspended. Please contact support for assistance.",
  email_not_verified:
    "Your email address has not been verified yet. Please check your inbox and verify before logging in.",
  invalid_login_input:
    "Please provide a valid username or email address along with your password.",
};
