import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { rMessage } from "../utils/responseMessages.js";
import { getClient } from "../config/db";

export const tokenAuth = async (req, res, next) => {
  let client;
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || typeof authHeader !== "string") {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.not_authorized,
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.not_authorized,
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.not_authorized,
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    if (!decoded || !decoded.userId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.invalid_token,
      });
    }

    client = await getClient();
    const result = await client.query(
      `
  SELECT id, is_active, email_verified
  FROM users
  WHERE id = $1
  LIMIT 1
  `,
      [decoded.userId],
    );

    if (result.rowCount === 0) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.user_not_found,
      });
    }

    const user = result.rows[0];

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

    req.user = {
      userId: decoded.userId,
    };

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.token_expired,
      });
    }

    return res.status(StatusCodes.FORBIDDEN).json({
      message: rMessage.invalid_token,
    });
  } finally {
    if (client) client.release();
  }
};
