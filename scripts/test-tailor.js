"use strict";

const { tailorResumeForJob } = require("../proxy/lib/resume-tailor");
const { GitHubModelsClient } = require("../proxy/lib/github-models-client");

async function run() {
  const client = new GitHubModelsClient();
  const context = {
    title: "Software Engineer I",
    company: "Renaissance Learning",
    description: `We are seeking a Full Stack Software Engineer with strong backend experience in .NET Core and frontend experience in React to build and maintain scalable services and APIs. The role focuses on backend service development, API implementation, testing, and collaboration with frontend teams, while using modern AI‑assisted development tools to improve productivity and code quality. 

In this role as a Software Engineer I, you will: 

    Design, develop, and maintain backend services and RESTful APIs using .NET Core/.NET 5+. 
    Implement and consume APIs that support React-based frontend applications. 
    Write and maintain unit and integration tests for backend and frontend components. 
    Work with existing SQL Server and PostgreSQL databases by querying and consuming data. 
    Collaborate with cross-functional teams to translate requirements into technical solutions. 
    Participate in code reviews, agile ceremonies, and continuous improvement initiatives. 
    Use AI-assisted development tools (e.g., Copilot, Cursor, Claude Code) to accelerate development and improve code quality.`,
  };
  
  const result = await tailorResumeForJob(client, {}, context);
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
