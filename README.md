# Greenhouse AI Autofill

Firefox extension + localhost proxy that fills Greenhouse job applications using deterministic field mapping and AI-generated answers from your profile data. Works with GitHub Copilot Models.

## Quick Start

### 1. Profile Data

Create two files in `profile-data/`:

**`profile.v2.json`** - your core facts:
```json
{
  "fullName": "Your Name",
  "firstName": "Your",
  "lastName": "Name",
  "email": "you@example.com",
  "phone": "+91 9876543210",
  "linkedInUrl": "https://linkedin.com/in/yourprofile",
  "githubUrl": "https://github.com/yourprofile",
  "location": "City, Country",
  "degree": "B.Tech in CS",
  "university": "Your University",
  "graduationYear": "2026",
  "totalExperience": "0",
  "technicalSkills": "TypeScript, React, Node.js",
  "noticePeriod": "Immediate",
  "workAuthorization": true,
  "needsSponsorship": false,
  "willingToRelocate": "Yes"
}
```

**`answers.v2.txt`** - Q/A for common screening questions:
```
Question: Why are you interested in this role?
Answer: Your specific answer here.

Question: Are you authorized to work?
Answer: Yes.

Notice period :: Immediate
Willing to relocate :: Yes
```

Also put your resume at `profile-data/resume.pdf`.

### 2. Configure Token

```bash
cp .env.example .env
# Set GITHUB_TOKEN=ghp_...
```

Your token needs `models:read` permission (Copilot Fine-Tuned Models or Models API scope).

### 3. Run

```bash
npm install
npm run start:proxy
```

Proxy starts at `http://127.0.0.1:8787`.

### 4. Load Extension

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

### 5. Use

1. Open a Greenhouse job application page
2. Click the extension icon
3. Click **Scan** - fields get fetched and resolved
4. Review suggestions in the overlay
5. Click **Apply** to fill the form
6. Click **Resume** / **Cover** to trigger file picker

If you update profile files, click **Reload Profile** in extension settings.

## How It Works

- **Deterministic resolver** maps fields by label keywords to your profile facts
- **Answer memory** remembers fields you've manually approved before
- **AI resolver** generates answers for remaining fields using context from your profile and Q/A bank
- **15-minute response cache** avoids duplicate AI calls for the same form
- No auto-submit - you review every suggestion before applying