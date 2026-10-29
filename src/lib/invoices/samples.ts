/**
 * Sample inputs for the "Load sample" buttons on /invoices/new.
 * The freelancer is Aarav Mishra, a designer-developer in Lucknow, India, working for US and UK clients
 * (billed in USD). Each sample says where the client is, so Claude can fill in their timezone.
 */

export const SAMPLE_AGREEMENTS = [
  {
    label: "Email thread (US client, hourly + % split)",
    text: `From: Jamie Rivera <jamie@riverabakery.example>
To: aarav@mishra.studio.example
Subject: Re: Website + photos — let's do it

Hi Aarav,

Thanks for the call yesterday (sorry it was so late on your side in Lucknow!). Confirming what we agreed:

- New Shopify theme setup and customization: 18 hours at your $85/hr rate
- Product photo retouching for 24 items. You said Kabir Sethi would do these and he gets 40% of the retouching line. Flat $1,200 for the set.
- 2 rounds of revisions included.

Please invoice Rivera Bakery LLC, attention me, and make it due within 5 days so it lands in this month's books.
We're in Austin, Texas, so we're on Central time.

Jamie

---
On Mon, Oct 26, Aarav wrote:
> Sounds good Jamie. Kabir's PayPal is kabir.sethi.retouch@example.com. I'll send the invoice once you confirm.
`,
  },
  {
    label: "Statement of work (UK client, milestones, installments)",
    text: `STATEMENT OF WORK #2026-14

Client: Okonkwo Legal Partners LLP ("Client"), 14 Fetter Lane, London EC4A 1BW, United Kingdom
Billing contact: Ada Okonkwo, Managing Partner — billing@okonkwolegal.example
Consultant: Aarav Mishra, Mishra Studio, Gomti Nagar, Lucknow, India ("Consultant")

1. Project: Client portal MVP

2. Deliverables & Fees (billed in USD)
   a. Discovery workshop and requirements doc ........ $2,500
   b. UX design (12 screens) ........................... $4,800
   c. Front-end build ................................... $7,200
   d. Deployment & handover ............................ $1,000

3. Payment schedule
   Milestone 1 (a + b) is invoiced on signature and due within 30 days.
   Milestone 2 (c + d) is invoiced on delivery.
   Client may pay any invoice in installments of no less than $1,500.

4. Subcontractors
   Consultant will engage Ishita Rao (UX research) for a fixed fee of $900 on Milestone 1,
   payable from Consultant's fees.

Signed: A. Okonkwo     Date: 2026-10-27
`,
  },
] as const;
