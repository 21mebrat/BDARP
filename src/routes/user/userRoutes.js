import express from "express"
import { tokenAuth } from "../../middlewares/tokenAuth";
import { apiKeyAuth } from "../../middlewares/apiKeyAuth";
import { roleAuth } from "../../middlewares/roleAuth";
import { registerUser } from "../../controllers/user/userController";

export const router = express.Router()

router
  .route("/register_user")
  .post(
    apiKeyAuth("GET_CRUSER_API"),
    registerUser,
  );

