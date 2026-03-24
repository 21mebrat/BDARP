import nodemailer from "nodemailer";

const createTransporter = () => {
  if (
    !process.env.GMAIL_USER ||
    !process.env.GMAIL_APP_PASSWORD
  ) {
    throw new Error(
      "[emailService] GMAIL_USER and GMAIL_APP_PASSWORD must be set in environment variables.",
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
};

export const transporter = createTransporter();