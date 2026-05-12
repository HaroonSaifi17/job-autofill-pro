"use strict";

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const { parseJsonFromModel } = require("./text-utils");

const PROFILE_DIR = path.resolve(__dirname, "..", "..", "profile-data");
const TEMPLATE_PATH = path.join(PROFILE_DIR, "Mohd_Haroon_Resume.tex");
const OUTPUT_ROOT = path.join(PROFILE_DIR, "generated-resumes");
const TEMP_DIR = path.join(OUTPUT_ROOT, "temp");
const PDF_DIR = path.join(OUTPUT_ROOT, "pdf");

const RESPONSE_SCHEMA = {
  name: "targeted_resume_rewrite",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tailoredTex: { type: "string", description: "The full LaTeX document tailored for the job" },
    },
    required: ["tailoredTex"],
  },
};

function slugify(value) {
  return (
    String(value || "job")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "job"
  );
}

function buildMessages(profile, context, template) {
  const job = {
    title: context.title || "",
    company: context.company || "",
    description: String(context.description || "").slice(0, 12000),
  };

  const payload = {
    job,
    originalLatexResume: template,
  };

  return [
    {
      role: "system",
      content: `You are an expert ATS resume optimizer. Your task is to take the provided LaTeX resume and the job description, and output the FULL updated LaTeX resume.
Rules:
1. Optimize the resume for this specific job by using ATS keywords from the job description.
2. DO NOT change the LaTeX layout, structure, or formatting. It is already perfect.
3. Keep changes minimal. Only update the content to better match the job.
4. For any bullet point or section you rewrite, the word count should be exactly the same as the original, or exactly one word less (n or n-1).
5. Output valid, compilable LaTeX.`
    },
    {
      role: "user",
      content: JSON.stringify(payload),
    },
  ];
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function findLatexCompiler() {
  for (const command of ["pdflatex", "tectonic", "xelatex"]) {
    const result = await runCommand(command, ["--version"], {
      cwd: PROFILE_DIR,
    });
    if (result.ok) {
      return command;
    }
  }
  return "";
}

async function compileLatex(texPath, outputDir) {
  const compiler = await findLatexCompiler();
  if (!compiler) {
    return {
      ok: false,
      warning:
        "No LaTeX compiler found. Install pdflatex, xelatex, or tectonic to produce PDFs.",
    };
  }

  const args =
    compiler === "tectonic"
      ? ["--outdir", outputDir, texPath]
      : [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-output-directory",
          outputDir,
          texPath,
        ];

  const result = await runCommand(compiler, args, { cwd: outputDir });
  return {
    ok: result.ok,
    compiler,
    warning: result.ok
      ? ""
      : (result.stderr || result.stdout || "LaTeX compilation failed.").slice(
          0,
          1000,
        ),
  };
}

async function tailorResumeForJob(client, profile, context) {
  const description = String(
    context && context.description ? context.description : "",
  ).trim();
  if (!client || description.length < 80) {
    return {
      ok: false,
      skipped: true,
      warning:
        "Resume tailoring skipped because job description or AI client is unavailable.",
    };
  }

  const template = await fs.readFile(TEMPLATE_PATH, "utf8");

  const completion = await client.completeStructured(
    buildMessages(profile, context, template),
    RESPONSE_SCHEMA,
  );
  
  const parsed = completion.parsed || parseJsonFromModel(completion.rawText) || {};
  const tailored = parsed.tailoredTex || template;

  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(PDF_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${slugify(context.company)}-${slugify(context.title)}-${stamp}`;
  const texPath = path.join(TEMP_DIR, `${baseName}.tex`);
  await fs.writeFile(texPath, tailored, "utf8");

  const compile = await compileLatex(texPath, PDF_DIR);
  const pdfPath = path.join(PDF_DIR, `${baseName}.pdf`);

  return {
    ok: true,
    model: completion.model,
    rewriteCount: 1, // Whole document was generated
    texPath,
    pdfPath: compile.ok ? pdfPath : "",
    compile,
  };
}

module.exports = {
  tailorResumeForJob,
};
