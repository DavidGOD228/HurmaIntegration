# Instructions for recruiters

This page is for your **recruiters**. Share it (or a short version) so they know how to get interview transcripts into Hurma automatically.

---

## How it works in one sentence

When you create an interview in Hurma and the meeting is recorded by Fireflies, the transcript and summary are automatically added to the candidate’s card in Hurma — **if** the meeting contains the candidate ID in the description or title.

---

## What recruiters need to do

### 1. Create the interview in Hurma as usual

Use Hurma Recruitment: open the candidate → recruitment action → **Invite candidate** (or your usual “create interview” flow). Fill in title, date, and **description** as below.

### 2. Put the candidate ID in the meeting description

When creating the interview, Hurma creates a calendar event. That event has a **description** (and optionally a title). The integration reads the candidate ID from there.

**In the meeting description**, add this line (replace `XXX` with the real ID):

```text
HURMA_CANDIDATE_ID=XXX
```

**How to find the candidate ID**

- Open the candidate in Hurma and look at the browser URL.  
  Example: `https://yourcompany.hurma.work/recruitment/candidates/Je`  
  The ID is the last part: **`Je`** (it can be letters and/or numbers).

**Example description**

```text
Intro call with the candidate
Vacancy: Frontend Developer
HURMA_CANDIDATE_ID=Je
```

**Optional:** you can also add it in the **title**, for example:

```text
Intro call | John Doe | CID:Je
```

### 3. Run the meeting as usual

- Join the Google Meet (or whatever link Hurma created).
- Make sure Fireflies is recording (company Fireflies bot or your connected account).
- After the meeting, Fireflies will transcribe and send the result to the integration; the note will appear on the candidate in Hurma.

---

## Who sets up what (admin vs recruiters)

| Who              | What they do |
|------------------|------------------------------------------------------------------|
| **Admin / you**  | Set the webhook **once** in Fireflies: URL + secret. No per-recruiter setup. |
| **Recruiters**   | Nothing to install. Only: when creating an interview in Hurma, add `HURMA_CANDIDATE_ID=XXX` (and optionally `CID:XXX` in the title). |

---

## If you have several recruiters

- **One webhook URL** is enough. Everyone’s meetings can use the same link (e.g. `https://hurmarecorder.development-test.website/webhooks/fireflies`).
- **One Fireflies setup:** the webhook is configured once in Fireflies (company account or the account that records the meetings). All recruiters whose meetings are recorded by that Fireflies account will have their transcripts processed.
- **No “code” or link for each recruiter:** recruiters do **not** put the webhook URL anywhere. They only add the candidate ID in the Hurma interview description (and optionally title) as above.

So: **same link and same code (secret) in Fireflies — set once by admin. Recruiters only add the candidate ID in the interview in Hurma.**

---

## Short version to send to recruiters

You can send them something like this:

```text
To get interview transcripts into the candidate card in Hurma automatically:

1. When you create an interview in Hurma (Invite candidate / calendar event), in the description add a line:
   HURMA_CANDIDATE_ID=XXX
   (XXX = candidate ID from the candidate’s URL in Hurma, e.g. "Je")

2. Optional: in the meeting title you can add: CID:XXX

3. Run the meeting as usual. After Fireflies finishes transcription, the summary and link will appear on the candidate in Hurma. You don’t need to do anything else.
```

---

## Troubleshooting for recruiters

- **Transcript didn’t appear on the candidate**  
  Check that the meeting description (or title) contained `HURMA_CANDIDATE_ID=...` (or `CID:...`) with the **exact** candidate ID from Hurma. If it’s missing or wrong, the integration can’t match the meeting to the candidate.

- **Where is the candidate ID?**  
  Open the candidate in Hurma and look at the URL: the part after `/candidates/` is the ID (e.g. `Je` in `.../candidates/Je`).
