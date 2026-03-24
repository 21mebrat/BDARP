import { buildVerificationEmail } from "./emailTemplates";
import { transporter } from "./emailTransporter";


export const sendVerificationEmail = async (userId, email, username) => {
  const token = generateAccessToken({
    userId: userId,
    email: email,
  });

  try {
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
    const { subject, html, text } = buildVerificationEmail(username, verifyUrl);

    await transporter.sendMail({
      from: `"Abugida Books" <${process.env.GMAIL_USER}>`,
      to: email,
      subject,
      html,
      text,
    });
    return true
  }catch(error){
    return false
  }
};
