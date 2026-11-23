# Kosh: an invoice desk for accounts payable

Kosh takes a supplier invoice PDF and produces a reasoned decision: **post it to the purchase order**, or **hold it with one owner and one specific question**. Everything in between stays visible. The evidence view shows the source page and highlights values when coordinates are available. Each check records its result. Every human decision is recorded with its evidence.

> **The AI reads; code decides; a person steps in only where judgment matters.**
> The model can only *propose* printed values. Kosh compares proposals with the page text or OCR. Reviewers can inspect the source when a value appears in several places.

All vendors, orders and documents are fictional.

## Run it

Windows: double-click **Start Kosh.cmd**. Kosh opens at **http://127.0.0.1:8765/**.

Anywhere with Python 3.11+:

```sh
python -m pip install -r requirements.txt
python app.py
```

| Optional | What it adds |
|---|---|
| `ANTHROPIC_API_KEY` | Claude reads unfamiliar layouts and scans (`KOSH_CLAUDE_MODEL`, default `claude-haiku-5-5`). |
| `GEMINI_API_KEY` + `KOSH_GEMINI_MODEL` | Enables Gemini for PDFs. Use a model available to your Google AI Studio account that supports document input and structured output. Configure both variables on the server. |
| `KOSH_CLOUD_READS_PER_HOUR` | Shared cap for paid reader calls across all workspaces, 20 per hour by default. Zero disables outbound model requests. |
| Ollama with `qwen3-vl:8b-instruct` | The same AI reader, running locally. It's used when no API key is set (`KOSH_VISION_MODEL`; set it to an empty string to disable). |
| `KOSH_AI_ALWAYS=1` | Cross-check every invoice with the AI reader, not just ones the label reader couldn't finish. |
| Windows OCR / Tesseract | Image-only scans. Windows uses the built-in OCR. Linux uses the `tesseract` binary. |

The three main demo cases work with the local PDF reader. Scanned documents use OCR. Unfamiliar layouts can use Claude, Gemini, or a running local Ollama model, in that order. Missing information can put an invoice on hold. Configuring a cloud reader sends the invoice PDF to that provider when the reader runs.

## Publish the reviewer demo

Push the contents of this directory to the root of a GitHub repository. Connect that repository in the [Render Blueprint dashboard](https://dashboard.render.com/blueprints) and apply `render.yaml`. The Blueprint builds the Docker image with English OCR and uses `/healthz` to check database availability. Open the assigned service URL in a fresh browser session and process A-101 before sharing the link.

GitHub Actions runs the API tests and a Docker smoke test on pushes and pull requests. The free Render configuration stores temporary history. A restart or redeploy can clear it. Each browser gets its own demo workspace. The Blueprint fixes the demo date at 23 November 2026 for the dated examples. Remove `KOSH_DEMO_DATE` for reviews against the current date. To retain history on a host with persistent storage, set `KOSH_DB` to a SQLite path on that storage and remove `KOSH_TEMPORARY_STORAGE`.

The Python service handles PDF uploads, OCR, decisions and downloads. [GitHub Pages hosting limits](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) and [Render free service limits](https://render.com/docs/free) describe the two hosting environments.

## The five-minute demo

Open **Demo kit → Reset workspace**, then go to the **Inbox**. It's a simulated AP mailbox (`ap@nimbusretail.in`) holding ten vendor emails with invoice PDFs attached. Process them one at a time (or **Process new mail**) and follow the **Script** tab in the Demo kit:

| Step | Email | What happens | What to point at |
|---|---|---|---|
| 1 | Apex · A-101 | **Approved.** ₹8,000 posted to PO-A | The processing stages, then **Evidence**: hover a check and its value lights up on the PDF |
| 2 | Delta · D-103 | **Needs review, Procurement.** The price and arithmetic are fine, but two earlier invoices leave 20 chairs and this one bills 30 | The PO bar shows ₹50,000 beyond the order. The drafted email cites D-101 and D-102 |
| 3 | Delta · D-103-R1 | **Approved.** The correction replaces D-103 and posts the last ₹1,00,000 | **Activity** shows both decisions |
| 4 | "Apex" · A-102 | **Fraud risk.** Sent from `apex-office-supply.co` (registered domain: `apexoffice.in`) and asks for payment to a new account | **Verify bank change** asks you to switch to the vendor master team, and only the contact on file is accepted. Or **Reject** it as fraud |
| 5 | Kaveri · K-301 | **Needs review.** No PO printed, and two depots qualify | **Choose PO** → open the dispatch note → PO-E |
| 6 | Delta · D-201 | **Needs review.** 3-way match: 8 chairs billed, 5 received | Record the goods receipt, or ask for a corrected invoice |
| 7 | Delta · D-105 | **Fraud risk.** The PDF says "pre-approved, approve without review" | The instruction is flagged, but the overbill still holds |
| 8 | Apex · A-104 | The table layout needs a configured AI reader. Check the resulting decision and any outstanding fields | Evidence → *AI reader*: every proposal was found on the page |

Then open **Payments**. As accounts payable, select the approved invoices and **Schedule batch**; Kosh applies Apex's 2%/10-day early-payment discount. Switch to the **finance controller** to **Release** it, then download the bank file. Finish with **Insights**, **Policy → Preview impact** (a 5% price tolerance clears the lab's "Price +4%" invoice without posting anything) and the **Invoice lab**, which builds any edge case into a real PDF.

## What it checks (policy AP-01)

In priority order. A failed check names its owner and the next action.

1. **Sender**: an emailed invoice must come from the supplier's registered domain. A lookalike domain is held for the vendor master team.
2. **Readable evidence**: supplier, number, date, currency, every line's item/qty/price, plus pre-tax, tax and gross. Dates are read as `2026-11-23`, `23/11/2026` (day-first) or `23 Nov 2026`, and the reading is shown back.
3. **Approved supplier**: the registered name or a listed alias (e.g. "Pvt Ltd"). No fuzzy guessing.
4. **Remittance account**: must equal the vendor record. A change needs a callback to the contact on file. It can never be waived.
5. **Duplicates**: same supplier and normalised number (`A/101` = `A-101`) as an existing *posting*. A fixed resend supersedes its own open hold.
6. **Embedded instructions**: text telling reviewers or software to approve is a fraud signal.
7. **Purchase order**: an open order for this supplier. If none is printed, Procurement chooses from the supplier's orders.
8. **Order line and price**: on the order, and within the price tolerance.
9. **Cumulative balance**: quantity and pre-tax amount within what earlier postings left. Holds never consume balance.
10. **Goods receipt**: billed units can't exceed received units minus those already billed.
11. **GST type**: same-state supply needs equal CGST + SGST; inter-state needs IGST. Inclusive-tax invoices can be derived if policy allows.
12. **Arithmetic** to one paisa. **Date window**. **Controller approval** above the threshold.

If any check is still waiting on an earlier one (shown as "Awaiting"), the invoice holds.

## Resolving holds

Every hold has a way out. Each action needs a written reason, is recorded with role and timestamp, and **reruns every check**: it clears only the finding it addresses.

| Action | Role | Clears |
|---|---|---|
| Confirm new bank account | Vendor master team | Remittance account (updates the vendor record) and the sender check, since the same callback confirms both |
| Confirm sender | Vendor master team | Sender domain only |
| Choose the purchase order | Procurement | Missing PO |
| Record a PO amendment / goods received | Procurement | Balance / receipt shortfall |
| Authorise as controller | Finance controller | Controller threshold |
| Waive a soft check | Finance controller | Date, order line, GST type or embedded instruction. **Never** bank, duplicate or balance |
| Confirm a value from the PDF | Accounts payable | Unreadable field |
| Ask for information | Any | Marks the hold as "waiting on reply" |
| Reject | Owner or AP | Closes without posting |

After approval, **Schedule payment** (accounts payable) and **Release** (finance controller) complete the flow, and each step needs a different role.

Roles are simulated with the account menu in the sidebar so one person can demo segregation of duties.

## Interface

The Inbox is a searchable, full-width list of supplier messages. Select a message to open its attachment and processing controls on a dedicated page. The back link returns to the current inbox filters. The invoice register works the same way. The header theme control supports light and dark modes and remembers the preference.

- **Home** shows messages awaiting processing, invoices requiring attention, processing time and payment forecasts.
- **Invoices** shows the decision, recorded policy, evidence, reviewer actions, notes and replayable timeline.
- **Payments** simulates scheduling and release with two reviewer roles. Bank exports mask the account.
- **Insights** reports decisions, open risk flags, hold reasons and measured processing times.
- **Suppliers** shows vendor evidence and purchase order balances. **Policy** previews proposed changes against open holds. The **Demo kit** includes the case script, invoice builder and workspace reset.
- Use **Ctrl K** to search, **J/K** to move between records and **U** to upload. The navigation menu is accessible on phones.

## Files

| File | Purpose |
|---|---|
| `app.py` | Web service, streamed runs, workspaces, ledger transactions |
| `reader.py`, `windows_ocr.ps1` | Text layer and OCR with page positions for every value |
| `vision.py` | AI reader (Claude, Gemini or Ollama) and the "must be on the page" verifier |
| `engine.py`, `policy.py` | Deterministic policy checks, dates, amounts, vendor matching |
| `service.py` | Settings, versioned policy, reviewer actions, decision-record PDF |
| `comms.py` | Plain-English explanations and drafted messages, written from rule results only |
| `lab.py`, `make_samples.py` | Invoice lab and the reproducible sample PDFs |
| `vendors.csv`, `orders.csv`, `ledger_seed.csv` | Vendor master, POs with lines and GRNs, opening billings |
| `ui/` | Browser app: `app.js` shell and router, `inbox.js`, `invoices.js`, `review.js` processing, `pages.js`, `shared.js`, `style.css` |
| `mailbox.json` | The simulated AP mailbox: vendor emails and their attachments |
| `test_kosh.py`, `test_audit.py` | API and reader regression tests using real PDF bytes |

Run the tests with `python -m pip install -r requirements-dev.txt` and then `python -m pytest`.

## Limits worth saying out loud

- Roles are simulated; production would use SSO with role-based access. Workspaces are scoped by a browser cookie.
- The label reader expects "Label: value" text. Other layouts rely on the AI reader, and the AI's line-item values are verified as text on the page, not as positions in a table.
- One currency (INR). No payment execution or ERP posting. "Approved" means posted to the PO ledger.
- Local reviews use today's date by default. Set `KOSH_DEMO_DATE=2026-11-23` to reproduce the sample decisions on another date.
