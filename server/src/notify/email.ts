import nodemailer from "nodemailer";
import { config } from "../config.js";

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (!config.smtp.configured) throw new Error("SMTP is not configured");
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: config.smtp.requireTls && !config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
      connectionTimeout: 15_000,
    });
  }
  return transport;
}

export async function sendEmail(subject: string, text: string): Promise<void> {
  await getTransport().sendMail({
    from: config.smtp.from,
    to: config.smtp.to,
    subject,
    text,
  });
}
