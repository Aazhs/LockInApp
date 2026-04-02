import nodemailer from "nodemailer";
import { SendResult } from "@lockin/shared";

export interface EmailConfig {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function canSendEmail(config: EmailConfig): boolean {
  return Boolean(
    config.host &&
      config.from &&
      config.user &&
      config.pass &&
      Number.isFinite(config.port) &&
      config.port > 0
  );
}

export async function sendEmailReport(
  config: EmailConfig,
  input: EmailSendInput
): Promise<SendResult> {
  if (!canSendEmail(config)) {
    return {
      ok: false,
      error: "Missing SMTP config. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM."
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });

    const info = await transport.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      text: input.textBody,
      html: input.htmlBody
    });

    return {
      ok: true,
      messageId: info.messageId
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "SMTP send failed"
    };
  }
}
