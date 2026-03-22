import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";

const SALT_ROUNDS = 12;

const ALLOWED_FIELDS = new Set([
  "username",
  "email",
  "password",
  "full_name",
  "website_url",
  "is_admin_panel",
]);

const PATTERNS = {
  username: /^[a-z0-9_\-.]{3,50}$/,
  email:    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/,
};

const isValidString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const parseWebsiteUrl = (raw) => {
  try {
    const parsed = new URL(raw.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

export const registerUser = async (req, res) => {
  let client;

  try {
    const body = req?.body ?? {};

    const unknownFields = Object.keys(body).filter(
      (key) => !ALLOWED_FIELDS.has(key),
    );
    if (unknownFields.length > 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.unknown_fields,
      });
    }

    let {
      username,
      email,
      password,
      full_name    = null,
      website_url  = null,
      is_admin_panel = "no",
    } = body;

    if (!isValidString(username) || !PATTERNS.username.test(username.trim())) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_username,
      });
    }

    if (!isValidString(email) || !PATTERNS.email.test(email.trim())) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_email,
      });
    }

    if (!isValidString(password) || !PATTERNS.password.test(password)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_password,
      });
    }

    if (website_url) {
      if (!isValidString(website_url)) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: rMessage.invalid_url,
        });
      }

      const normalised = parseWebsiteUrl(website_url);
      if (!normalised) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: rMessage.invalid_url,
        });
      }
      website_url = normalised;
    }

    username   = username.trim().toLowerCase();
    email      = email.trim().toLowerCase();
    password   = password.trim();
    full_name  = isValidString(full_name)  ? full_name.trim()  : null;
    website_url = website_url               ? website_url        : null;

    const userRole = is_admin_panel === "yes" ? "Admin" : "User";

    client = await getClient();
    await client.query("BEGIN");

    // Conflict check — one query covers both username and email
    const { rows: existing } = await client.query(
      `SELECT
         (username = $1) AS username_taken,
         (email    = $2) AS email_taken
       FROM users
       WHERE username = $1 OR email = $2
       LIMIT 1`,
      [username, email],
    );

    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.CONFLICT).json({
        message: rMessage.user_already_exists,
      });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user — let the DB auto-generate the primary key
    const { rows: created } = await client.query(
      `INSERT INTO users
         (username, email, password_hash, full_name, website_url, is_active, is_verified)
       VALUES
         ($1, $2, $3, $4, $5, TRUE, FALSE)
       RETURNING id`,
      [username, email, password_hash, full_name, website_url],
    );

    const newUser = created[0];

    // Resolve role — must exist in the roles table
    const { rows: roles } = await client.query(
      `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
      [userRole],
    );

    if (!roles.length) {
      throw new Error(`System role "${userRole}" was not found in the database.`);
    }

    // Assign role
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_at)
       VALUES ($1, $2, NOW())`,
      [newUser.id, roles[0].id],
    );

    await client.query("COMMIT");

    return res.status(StatusCodes.CREATED).json({
      message: rMessage.user_registered,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};