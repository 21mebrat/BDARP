import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";
import { buildVerificationEmail } from "../../utils/emailTemplates.js";
import { sendVerificationEmail } from "../../utils/sendVerificationEmail.js";
import { validateAndSaveFile } from "../../utils/saveFiles.js";

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

    //send email verification
    const verificationResult = await sendVerificationEmail(
      userId,
      email,
      username,
    );
    if (!verificationResult) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.email_not_verified,
      });
    }
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
      message: rMessage.verification_email_sent,
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
    res.Cookies("tid", accessToken);

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

export const verifyEmail = async (req, res) => {
  let client;

  try {
    const token = req?.query?.token;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_verification_token,
      });
    }

    const cleanToken = token.trim();
    const decoded = jwt.verify(cleanToken, process.env.ACCESS_TOKEN_SECRET);

    if (!decoded || !decoded.userId || !decoded?.email) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.invalid_verification_token,
      });
    }

    client = await getClient();

    const result = await client.query(
      `
  SELECT id, is_active, email
  FROM users
  WHERE id = $1 AND email = $2
  LIMIT 1
  `,
      [decoded.userId, decoded.email],
    );

    if (result.rowCount === 0) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.invalid_verification_token,
      });
    }

    await client.query("BEGIN");

    await client.query(
      `UPDATE users
       SET is_verified = TRUE,
           updated_at  = NOW()
       WHERE id = $1 AND email = $2`,
      [decoded.userId, decoded.email],
    );
    await client.query("COMMIT");

    return res.status(StatusCodes.OK).json({
      message: rMessage.email_verified_success,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});

    // Handle JWT specific errors
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.invalid_verification_token,
      });
    }

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const changePassword = async (req, res) => {
  let client;

  try {
    const { current_password, new_password } = req?.body ?? {};
    const userId = req.user?.userId;

    // ── 1. Input presence check ────────────────────────────────────────────
    if (!isValidString(current_password) || !isValidString(new_password)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
      });
    }

    const cleanCurrent = current_password.trim();
    const cleanNew = new_password.trim();

    if (!PATTERNS?.password.test(cleanNew)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_new_password,
      });
    }

    if (cleanCurrent === cleanNew) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.new_password_same_as_old,
      });
    }

    client = await getClient();

    const { rows } = await client.query(
      `SELECT password_hash
       FROM   users
       WHERE  id = $1
       LIMIT  1`,
      [userId],
    );

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: rMessage.user_not_found,
      });
    }

    const { password_hash } = rows[0];

    const isMatch = await bcrypt.compare(cleanCurrent, password_hash);

    if (!isMatch) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        message: rMessage.incorrect_current_password,
      });
    }

    const isSameAsStored = await bcrypt.compare(cleanNew, password_hash);

    if (isSameAsStored) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.new_password_same_as_old,
      });
    }

    const new_password_hash = await bcrypt.hash(cleanNew, SALT_ROUNDS);

    await client.query(
      `UPDATE users
       SET    password_hash = $1,
              updated_at    = NOW()
       WHERE  id = $2`,
      [new_password_hash, userId],
    );

    return res.status(StatusCodes.OK).json({
      message: rMessage.password_changed_success,
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const updateProfile = async (req, res) => {
  let client;

  const ALLOWED_UPDATE_FIELDS = new Set([
    "full_name",
    "bio",
    "website_url",
    "profile_photo",
  ]);

  const LIMITS = {
    full_name_min: 2,
    full_name_max: 100,
    bio_max: 300,
  };

  const isValidUrl = (value) => {
    try {
      const parsed = new URL(value.trim());
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  try {
    const userId = req.user?.userId;

    const fields = req.formFields ?? {};
    const files = req.formFiles ?? {};

    const unknownFields = Object.keys(fields).filter(
      (key) => !ALLOWED_UPDATE_FIELDS.has(key),
    );

    if (unknownFields.length > 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.unknown_update_fields,
        meta: { unknownFields },
      });
    }

    const hasTextFields = Object.keys(fields).some((key) =>
      ALLOWED_UPDATE_FIELDS.has(key),
    );
    const hasFileFields = "profile_photo" in files;

    if (!hasTextFields && !hasFileFields) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.no_update_fields,
      });
    }

    const errors = {};
    const sanitised = {};

    if ("full_name" in fields) {
      const val = fields.full_name;

      if (val === null) {
        sanitised.full_name = null;
      } else if (!isValidString(val)) {
        errors.full_name = rMessage.full_name_invalid;
      } else {
        const trimmed = val.trim();
        const namePattern = /^[\p{L}\s'\-.]{2,100}$/u;

        if (
          trimmed.length < LIMITS.full_name_min ||
          trimmed.length > LIMITS.full_name_max ||
          !namePattern.test(trimmed)
        ) {
          errors.full_name = rMessage.full_name_invalid;
        } else {
          sanitised.full_name = trimmed;
        }
      }
    }

    if ("bio" in fields) {
      const val = fields.bio;

      if (val === null) {
        sanitised.bio = null;
      } else if (!isValidString(val)) {
        errors.bio = rMessage.bio_too_long;
      } else {
        const trimmed = val.trim();

        if (trimmed.length > LIMITS.bio_max) {
          errors.bio = rMessage.bio_too_long;
        } else {
          sanitised.bio = trimmed;
        }
      }
    }

    if ("website_url" in fields) {
      const val = fields.website_url;

      if (val === null) {
        sanitised.website_url = null;
      } else if (!isValidString(val) || !isValidUrl(val)) {
        errors.website_url = rMessage.invalid_url;
      } else {
        sanitised.website_url = new URL(val.trim()).href;
      }
    }

    if ("profile_photo" in files) {
      const file = files.profile_photo;

      try {
        sanitised.profile_photo_url = await validateAndSaveFile(file, {
          folder: "UserProfile",
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
          maxSizeMB: 5,
        });
      } catch (uploadError) {
        errors.profile_photo =
          uploadError.message ?? rMessage.profile_photo_invalid;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.invalid_request,
      });
    }

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [column, value] of Object.entries(sanitised)) {
      setClauses.push(`${column} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    client = await getClient();

    const { rows } = await client.query(
      `UPDATE users
       SET ${setClauses.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING
         id,
         username,
         email,
         full_name,
         bio,
         website_url,
         profile_photo_url,
         updated_at`,
      values,
    );

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: rMessage.user_not_found,
      });
    }

    return res.status(StatusCodes.OK).json({
      message: rMessage.profile_updated,
      data: { user: rows[0] },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const getUsers = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const sort = req.query.sort === "asc" ? "ASC" : "DESC";
    const search = req.query.search?.trim() || null;

    const offset = (page - 1) * limit;

    client = await getClient();

    let query = `
      SELECT id, username, email, full_name, bio, website_url, profile_photo_url, is_active, is_verified, created_at
      FROM users
    `;
    const values = [];

    if (search) {
      query += ` WHERE username ILIKE $1 OR email ILIKE $1 OR full_name ILIKE $1`;
      values.push(`%${search}%`);
    }

    query += ` ORDER BY created_at ${sort} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const { rows } = await client.query(query, values);

    // Total count for pagination
    let countQuery = "SELECT COUNT(*) AS total FROM users";
    if (search)
      countQuery += ` WHERE username ILIKE $1 OR email ILIKE $1 OR full_name ILIKE $1`;
    const { rows: countRows } = await client.query(
      countQuery,
      search ? [`%${search}%`] : [],
    );
    const total = parseInt(countRows[0].total);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.success,
      data: {
        users: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("getUsers error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const getUser = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const identifier = req.params?.id?.trim();
    if (!identifier) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    client = await getClient();

    let query = `
      SELECT id, username, email, full_name, bio, website_url, profile_photo_url, is_active, is_verified, created_at, updated_at
      FROM users
      WHERE id = $1 OR username = $1
      LIMIT 1
    `;
    const { rows } = await client.query(query, [identifier]);

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.user_not_found,
        data: null,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.success,
      data: { user: rows[0] },
    });
  } catch (error) {
    console.error("getUser error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};
