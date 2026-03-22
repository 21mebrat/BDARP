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
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password:
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/,
};

const resolveIdentifierType = (identifier) => {
  if (PATTERNS.email.test(identifier)) return "email";
  if (PATTERNS.username.test(identifier)) return "username";
  return null;
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
      full_name = null,
      website_url = null,
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

    username = username.trim().toLowerCase();
    email = email.trim().toLowerCase();
    password = password.trim();
    full_name = isValidString(full_name) ? full_name.trim() : null;
    website_url = website_url ? website_url : null;

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
      throw new Error(
        `System role "${userRole}" was not found in the database.`,
      );
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

export const loginUser = async (req, res) => {
  let client;

  try {
    const body = req?.body ?? {};

    const { identifier, password } = body;

    if (!isValidString(identifier) || !isValidString(password)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_login_input,
      });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const cleanPassword = password.trim();

    const identifierType = resolveIdentifierType(cleanIdentifier);

    if (!identifierType) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_login_input,
      });
    }

    client = await getClient();

    const column = identifierType === "email" ? "email" : "username";

    const { rows } = await client.query(
      `SELECT
         id,
         username,
         email,
         full_name,
         profile_photo_url,
         password_hash,
         is_active,
         is_verified
       FROM users
       WHERE ${column} = $1
       LIMIT 1`,
      [cleanIdentifier],
    );

    const user = rows[0] ?? null;

    const passwordMatch = user
      ? await bcrypt.compare(cleanPassword, user.password_hash)
      : false;

    if (!user || !passwordMatch) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        message: rMessage.invalid_credentials,
      });
    }

    if (!user.is_active) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.account_disabled,
      });
    }

    if (!user.is_verified) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.email_not_verified,
      });
    }
    const accessToken = jwt.sign(
        { userId: user?.id },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY },
    );
    res.Cookies("tid",accessToken)

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.login_success,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          profile_photo_url: user.profile_photo_url,
        },
        token: accessToken,
      },
    });
  } catch (_) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};
