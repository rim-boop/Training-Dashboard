// Branding for this deployment. Public: it only returns what's printed on the page.
//
//   GET /api/brand -> { name, color, logo }
//
// Set per client in the hosting settings:
//   BRAND_NAME   the company name shown in the sidebar and on sign-in screens ("Solenne Studio")
//   BRAND_COLOR  main colour as a hex code ("#0E6E55"). Buttons, the selected menu item and progress bars use it.
//   BRAND_LOGO   optional https:// link to a square logo image. Without it, the first letter of the name is shown.

const HEX = /^#[0-9a-fA-F]{6}$/;

export default function handler(req, res) {
  const name = (process.env.BRAND_NAME || "").trim().slice(0, 60) || "Team portal";
  const color = HEX.test((process.env.BRAND_COLOR || "").trim()) ? process.env.BRAND_COLOR.trim() : "#0E6E55";
  const logo = /^https:\/\/\S+$/.test((process.env.BRAND_LOGO || "").trim()) ? process.env.BRAND_LOGO.trim() : null;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ name, color, logo });
}
