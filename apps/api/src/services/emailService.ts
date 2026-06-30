import { Resend } from 'resend';
import { env } from '../env.js';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export function isEmailConfigured(): boolean {
  return resend !== null;
}

// Same palette as apps/web/app/styles.css's :root CSS variables, converted to hex
// since email clients don't reliably support hsl()/CSS variables.
const COLORS = {
  pageBackground: '#f5eee6', // --muted
  card: '#ffffff', // --card
  foreground: '#493b2d', // --foreground
  mutedForeground: '#89755d', // --muted-foreground / --primary
  accent: '#c17053', // --accent
  border: '#e4d8c8', // --border
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function renderEmail(opts: { bodyHtml: string; ctaLabel?: string; ctaUrl?: string }): string {
  const { bodyHtml, ctaLabel, ctaUrl } = opts;

  const cta =
    ctaLabel && ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0 8px;">
          <tr>
            <td style="border-radius: 8px; background-color: ${COLORS.accent};">
              <a href="${ctaUrl}" style="display: inline-block; padding: 12px 24px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
                ${ctaLabel}
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 8px 0 0; font-size: 13px; color: ${COLORS.mutedForeground}; word-break: break-all;">
          Oder Link öffnen: <a href="${ctaUrl}" style="color: ${COLORS.mutedForeground};">${ctaUrl}</a>
        </p>
      `
      : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.pageBackground}; padding: 32px 16px; font-family: ${FONT_STACK};">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; width: 100%; background-color: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden;">
            <tr>
              <td style="padding: 24px 32px; border-bottom: 1px solid ${COLORS.border};">
                <span style="font-size: 20px; font-weight: 800; color: ${COLORS.foreground};">
                  <span style="color: ${COLORS.accent};">+</span> EvenUp
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px; color: ${COLORS.foreground}; font-size: 15px; line-height: 1.6;">
                ${bodyHtml}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 32px 24px; border-top: 1px solid ${COLORS.border};">
                <p style="margin: 0; font-size: 12px; color: ${COLORS.mutedForeground};">
                  EvenUp — Gemeinsame Ausgaben einfach aufteilen
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export async function sendJoinRequestEmail(
  to: string,
  inviterName: string,
  groupName: string,
): Promise<void> {
  if (!resend) return;

  const loginUrl = `${env.APP_URL ?? ''}/login`;

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM ?? 'EvenUp <onboarding@resend.dev>',
    to,
    subject: `Einladung zur Gruppe „${groupName}“ — EvenUp`,
    html: renderEmail({
      bodyHtml: `
        <p style="margin: 0 0 12px;">Hallo,</p>
        <p style="margin: 0;"><strong>${inviterName}</strong> hat dich zur Gruppe „${groupName}“ auf EvenUp eingeladen. Melde dich an, um die Einladung anzunehmen oder abzulehnen.</p>
      `,
      ctaLabel: 'Einladung ansehen',
      ctaUrl: loginUrl,
    }),
  });

  if (error) {
    throw new Error(`Resend error (${error.name}): ${error.message}`);
  }
}

export async function sendJoinRequestAcceptedEmail(
  to: string,
  accepterName: string,
  groupName: string,
  groupId: string,
): Promise<void> {
  if (!resend) return;

  const groupUrl = `${env.APP_URL ?? ''}/groups/${groupId}`;

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM ?? 'EvenUp <onboarding@resend.dev>',
    to,
    subject: `${accepterName} ist „${groupName}“ beigetreten — EvenUp`,
    html: renderEmail({
      bodyHtml: `
        <p style="margin: 0 0 12px;">Hallo,</p>
        <p style="margin: 0;"><strong>${accepterName}</strong> hat deine Einladung zur Gruppe „${groupName}“ angenommen.</p>
      `,
      ctaLabel: 'Gruppe ansehen',
      ctaUrl: groupUrl,
    }),
  });

  if (error) {
    throw new Error(`Resend error (${error.name}): ${error.message}`);
  }
}
