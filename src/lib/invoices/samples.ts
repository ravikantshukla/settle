/** Sample inputs for the "Load sample" buttons on /invoices/new. */

export const SAMPLE_AGREEMENTS = [
  {
    label: "Email thread (hourly + % split)",
    text: `From: Jamie Rivera <jamie@riverabakery.example>
To: hello@yourstudio.example
Subject: Re: Website + photos — let's do it

Hi!

Thanks for the call yesterday. Confirming what we agreed:

- New Shopify theme setup and customization: 18 hours at your $85/hr rate
- Product photography for 24 items — you said Leo Park would shoot these and he gets 40% of the photography line. Flat $1,200 for the shoot.
- 2 rounds of revisions included.

Please invoice Rivera Bakery LLC, attention me. We usually pay net 15.

Jamie

---
On Mon, Oct 26, you wrote:
> Sounds good Jamie. Leo's PayPal is leo.park.photo@example.com. I'll send the invoice once you confirm.
`,
  },
  {
    label: "Statement of work (milestones, installments)",
    text: `STATEMENT OF WORK #2026-14

Client: Okonkwo Legal Partners ("Client")
Billing contact: Ada Okonkwo, Managing Partner — billing@okonkwolegal.example
Consultant: Your Studio ("Consultant")

1. Project: Client portal MVP

2. Deliverables & Fees (USD)
   a. Discovery workshop and requirements doc ........ $2,500
   b. UX design (12 screens) ........................... $4,800
   c. Front-end build ................................... $7,200
   d. Deployment & handover ............................ $1,000

3. Payment schedule
   Milestone 1 (a + b) is invoiced on signature and due within 30 days.
   Milestone 2 (c + d) is invoiced on delivery.
   Client may pay any invoice in installments of no less than $1,500.

4. Subcontractors
   Consultant will engage Mira Chen (UX research) for a fixed fee of $900 on Milestone 1,
   payable from Consultant's fees.

Signed: A. Okonkwo     Date: 2026-10-27
`,
  },
] as const;
