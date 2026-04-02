import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({
    sendMail
  }));
  return { sendMail, createTransport };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.createTransport
  }
}));

import { canSendEmail, sendEmailReport } from "./email";

describe("email sender", () => {
  beforeEach(() => {
    mocks.sendMail.mockReset();
    mocks.createTransport.mockClear();
  });

  it("validates required smtp config", () => {
    expect(
      canSendEmail({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "user@gmail.com",
        pass: "app-pass",
        from: "LockIn <user@gmail.com>"
      })
    ).toBe(true);

    expect(
      canSendEmail({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "",
        pass: "app-pass",
        from: "LockIn <user@gmail.com>"
      })
    ).toBe(false);
  });

  it("sends html + text report via nodemailer", async () => {
    mocks.sendMail.mockResolvedValue({
      messageId: "msg-123"
    });

    const result = await sendEmailReport(
      {
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "user@gmail.com",
        pass: "app-pass",
        from: "LockIn <user@gmail.com>"
      },
      {
        to: "me@example.com",
        subject: "Daily report",
        textBody: "plain text",
        htmlBody: "<html><body>rich</body></html>"
      }
    );

    expect(result).toEqual({
      ok: true,
      messageId: "msg-123"
    });
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "me@example.com",
        subject: "Daily report",
        text: "plain text",
        html: "<html><body>rich</body></html>"
      })
    );
  });
});
