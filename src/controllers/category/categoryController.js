import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";
import { validate as uuidValidate } from "uuid";

export const categoryErrors = {
  category_name_required: "Category name is required.",
  category_name_length: "Category name must not exceed 120 characters.",
  category_slug_required: "Category slug is required.",
  category_slug_length: "Category slug must not exceed 120 characters.",
  category_slug_exists: "Category slug already exists.",
  category_name_exists: "Category name already exists.",
  category_not_found: "Category not found.",
  category_parent_invalid: "Parent category does not exist.",
  category_parent_self: "Category cannot be its own parent.",
  category_color_invalid: "Color must be a valid HEX format (#FFFFFF).",
};

const hexRegex = /^#[0-9A-Fa-f]{6}$/;

const validateColor = (color) => {
  if (!color) return true;
  return hexRegex.test(color);
};

export const createCategory = async (req, res) => {
  const { name, slug, parent_id, color_hex, sort_order } = req.body;

  if (!name)
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_name_required,
    });

  if (name.length > 120)
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_name_length,
    });

  if (!slug)
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_slug_required,
    });

  if (slug.length > 120)
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_slug_length,
    });

  if (!validateColor(color_hex))
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_color_invalid,
    });

  let client;

  try {
    client = await getClient();

    /*
    |--------------------------------------------------------------------------
    | Check duplicate name
    |--------------------------------------------------------------------------
    */

    const nameCheck = await client.query(
      `SELECT id FROM categories WHERE name = $1 LIMIT 1`,
      [name.trim()],
    );

    if (nameCheck.rowCount > 0)
      return res.status(StatusCodes.CONFLICT).json({
        message: categoryErrors.category_name_exists,
      });

    /*
    |--------------------------------------------------------------------------
    | Check duplicate slug
    |--------------------------------------------------------------------------
    */

    const slugCheck = await client.query(
      `SELECT id FROM categories WHERE slug = $1 LIMIT 1`,
      [slug.trim()],
    );

    if (slugCheck.rowCount > 0)
      return res.status(StatusCodes.CONFLICT).json({
        message: categoryErrors.category_slug_exists,
      });

    /*
    |--------------------------------------------------------------------------
    | Validate parent category
    |--------------------------------------------------------------------------
    */

    if (parent_id) {
      if (!uuidValidate(parent_id))
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: categoryErrors.category_parent_invalid,
        });

      const parentCheck = await client.query(
        `SELECT id FROM categories WHERE id = $1 LIMIT 1`,
        [parent_id],
      );

      if (parentCheck.rowCount === 0)
        return res.status(StatusCodes.BAD_REQUEST).json({
          message: categoryErrors.category_parent_invalid,
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Insert category
    |--------------------------------------------------------------------------
    */

    const result = await client.query(
      `
      INSERT INTO categories
      (name, slug, parent_id, color_hex, sort_order)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        name.trim(),
        slug.trim(),
        parent_id || null,
        color_hex || null,
        sort_order || 0,
      ],
    );

    return res.status(StatusCodes.CREATED).json({
      message: "Category created successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const getCategories = async (_, res) => {
  let client;

  try {
    client = await getClient();

    const result = await client.query(`
      SELECT id, name, slug, parent_id, color_hex, sort_order, created_at
      FROM categories
      ORDER BY sort_order ASC, name ASC
    `);

    return res.status(StatusCodes.OK).json({
      data: result.rows,
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const getCategoryById = async (req, res) => {
  const { id } = req.params;

  if (!uuidValidate(id))
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_not_found,
    });

  let client;

  try {
    client = await getClient();

    const result = await client.query(
      `SELECT * FROM categories WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (result.rowCount === 0)
      return res.status(StatusCodes.NOT_FOUND).json({
        message: categoryErrors.category_not_found,
      });

    return res.status(StatusCodes.OK).json({
      data: result.rows[0],
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, slug, parent_id, color_hex, sort_order } = req.body;

  if (!uuidValidate(id))
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_not_found,
    });

  if (parent_id && parent_id === id)
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_parent_self,
    });

  if (color_hex && !validateColor(color_hex))
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_color_invalid,
    });

  let client;

  try {
    client = await getClient();

    const category = await client.query(
      `SELECT id FROM categories WHERE id = $1`,
      [id],
    );

    if (category.rowCount === 0)
      return res.status(StatusCodes.NOT_FOUND).json({
        message: categoryErrors.category_not_found,
      });

    /*
    |--------------------------------------------------------------------------
    | Update
    |--------------------------------------------------------------------------
    */

    const result = await client.query(
      `
      UPDATE categories
      SET name = COALESCE($1,name),
          slug = COALESCE($2,slug),
          parent_id = COALESCE($3,parent_id),
          color_hex = COALESCE($4,color_hex),
          sort_order = COALESCE($5,sort_order),
          updated_at = now()
      WHERE id = $6
      RETURNING *
      `,
      [name, slug, parent_id, color_hex, sort_order, id],
    );

    return res.status(StatusCodes.OK).json({
      message: "Category updated successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.server_error,
    });
  } finally {
    if (client) client.release();
  }
};

export const deleteCategory = async (req, res) => {
  const { id } = req.params;

  if (!uuidValidate(id))
    return res.status(StatusCodes.BAD_REQUEST).json({
      message: categoryErrors.category_not_found,
    });

  let client;

  try {
    client = await getClient();

    const result = await client.query(
      `DELETE FROM categories WHERE id=$1 RETURNING id`,
      [id],
    );

    if (result.rowCount === 0)
      return res.status(StatusCodes.NOT_FOUND).json({
        message: categoryErrors.category_not_found,
      });

    return res.status(StatusCodes.OK).json({
      message: "Category deleted successfully.",
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: rMessage.server_error,
    });
  } finally {
    if (client) client.release();
  }
};