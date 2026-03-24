import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";

const ALLOWED_FIELDS = new Set([
  "name",
  "bio",
  "birth_date",
  "death_date",
  "nationality",
  "website_url",
]);

const LIMITS = {
  name_max: 200,
  bio_max: 5000,
  nationality_max: 100,
};

const isValidString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const parseUrl = (value) => {
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

const generateSlug = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export const createAuthor = async (req, res) => {
  let client;

  try {
    const body = req?.body ?? {};
    const userId = req.user?.userId;

    const unknownFields = Object.keys(body).filter(
      (f) => !ALLOWED_FIELDS.has(f)
    );

    if (unknownFields.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.unknown_fields,
      });
    }

    let {
      name,
      bio = null,
      birth_date = null,
      death_date = null,
      nationality = null,
      website_url = null,
    } = body;

    if (!isValidString(name) || name.trim().length > LIMITS.name_max) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.author_name_invalid,
      });
    }

    name = name.trim();

    if (bio && (!isValidString(bio) || bio.length > LIMITS.bio_max)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.author_bio_invalid,
      });
    }

    if (
      nationality &&
      (!isValidString(nationality) ||
        nationality.trim().length > LIMITS.nationality_max)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.author_nationality_invalid,
      });
    }

    if (birth_date) {
      const birth = new Date(birth_date);

      if (birth > new Date()) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: rMessage.author_birth_future,
        });
      }

      birth_date = birth;
    }

    if (death_date) {
      const death = new Date(death_date);

      if (birth_date && death <= birth_date) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: rMessage.author_death_before_birth,
        });
      }

      death_date = death;
    }

    if (website_url) {
      const parsed = parseUrl(website_url);

      if (!parsed) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: rMessage.invalid_url,
        });
      }

      website_url = parsed;
    }

    const slug = generateSlug(name);

    client = await getClient();
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      `SELECT id FROM authors WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (existing.length) {
      await client.query("ROLLBACK");

      return res.status(StatusCodes.CONFLICT).json({
        message: rMessage.author_already_exists,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO authors
        (name, slug, bio, birth_date, death_date, nationality, website_url, created_by)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, slug`,
      [
        name,
        slug,
        bio,
        birth_date,
        death_date,
        nationality,
        website_url,
        userId,
      ]
    );

    await client.query("COMMIT");

    return res.status(StatusCodes.CREATED).json({
      message: rMessage.author_created_success,
      data: rows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const getAuthor = async (req, res) => {
  let client;

  try {
    const { id } = req.params;

    client = await getClient();

    const { rows } = await client.query(
      `SELECT
        id,
        name,
        slug,
        bio,
        photo_url,
        birth_date,
        death_date,
        nationality,
        website_url,
        created_at
      FROM authors
      WHERE id = $1
      LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: rMessage.author_not_found,
      });
    }

    return res.status(StatusCodes.OK).json({
      data: rows[0],
    });
  } catch (_) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const listAuthors = async (req, res) => {
  let client;

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search?.trim() || null;

    const offset = (page - 1) * limit;

    client = await getClient();

    let query = `
      SELECT id, name, slug, nationality, birth_date
      FROM authors
    `;

    const values = [];

    if (search) {
      query += ` WHERE name ILIKE $1`;
      values.push(`%${search}%`);
    }

    query += ` ORDER BY name ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

    values.push(limit, offset);

    const { rows } = await client.query(query, values);

    return res.status(StatusCodes.OK).json({
      data: rows,
      meta: {
        page,
        limit,
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

export const updateAuthor = async (req, res) => {
  let client;

  try {
    const { id } = req.params;
    const body = req?.body ?? {};

    const unknownFields = Object.keys(body).filter(
      (f) => !ALLOWED_FIELDS.has(f)
    );

    if (unknownFields.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.unknown_update_fields,
      });
    }

    const updates = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(body)) {
      updates.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }

    if (!updates.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.no_update_fields,
      });
    }

    client = await getClient();

    const { rows } = await client.query(
      `UPDATE authors
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${index}
       RETURNING id,name,slug`,
      [...values, id]
    );

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: rMessage.author_not_found,
      });
    }

    return res.status(StatusCodes.OK).json({
      message: rMessage.author_updated_success,
      data: rows[0],
    });
  } catch (_) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const deleteAuthor = async (req, res) => {
  let client;

  try {
    const { id } = req.params;

    client = await getClient();

    const { rowCount } = await client.query(
      `DELETE FROM authors WHERE id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: rMessage.author_not_found,
      });
    }

    return res.status(StatusCodes.OK).json({
      message: rMessage.author_deleted_success,
    });
  } catch (_) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.internal_server_error,
    });
  } finally {
    if (client) client.release();
  }
};