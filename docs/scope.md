# Webb school AI scope and priorities

Updated November 23, 2026. This LibreChat fork is a candidate for WebbGPT's next
version within the AI Project@Webb. The first study focuses on useful academic
work, clear guidance about permitted assistance, student control and inspectable
sources and tool results. A decision to replace WebbGPT follows evaluation with
students and educators.

This is the current planning reference. The
[Webb research note](devdocs/2026-11-23-webb.md) records the reasoning and sources;
[school.md](school.md) describes the implemented prototype. This order of work
supersedes the earlier sequence that put Microsoft account integration next.

## Academic activities

| Activity                               | Assistance to study                                                                                           | Work the learner retains                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Understanding assignments and studying | Retrieve Canvas instructions and rubrics; explain concepts; offer hints, practice and feedback on an attempt. | Attempt problems, develop understanding and explain reasoning.   |
| Reading, research and revision         | Find passages and public sources; show evidence; critique a student's draft.                                  | Read, form arguments, choose evidence and retain their voice.    |
| Investigating data and building        | Check calculations, make plots, test code and expose results for inspection.                                  | Choose questions, interpret observations and defend conclusions. |

Faculty preparation remains in scope: preparing questions, comparing readings and
reviewing draft materials. Teachers review outputs and can describe their own AI
assistance. Automated grading and academic misconduct decisions are excluded.

The learning objective determines appropriate delegation. A research activity may
permit substantial calculation; an exercise teaching those calculations may
require the student to perform them. Preserve capable ordinary chat alongside
education helpers. A hint-first approach is a useful choice, not a universal
restriction on every student conversation.

## Ordered development priorities

1. **Choose the study activities with students and faculty.** Select actual
   assignments, identify the learning objective and record the teacher's written
   assistance guidance. Include students who are skeptical or prefer other
   tools. Use synthetic or explicitly admitted materials during development.
2. **Complete one assignment help experience.** Reuse the existing Canvas tools
   and picker. Keep the assignment, rubric, source links and teacher guidance
   accessible beside the conversation. Offer convenient hint, practice and
   critique choices. If assistance guidance is absent, show that its status is
   unknown and direct the student to their teacher. Done means a student can
   identify the task, its sources and the stated assistance boundary without
   searching through tool output.
3. **Make evidence and delegation easy to inspect.** Reuse native tool activity,
   citations, file delivery and browser controls. Show which sources were
   actually read, disclose incomplete retrieval, and expose calculations and
   outputs when used. Verify cancellation for each enabled tool path. Add a
   short, editable AI-use summary based on visible assistance and tool records;
   let the person review it before copying or exporting it. It must not invent
   authorship, certify honesty or expose hidden model reasoning. Apply the same
   disclosure option to faculty preparation.
4. **Evaluate a small approved model choice.** Compare a few capable models on
   the selected activities, including answer quality, tool reliability and cost.
   Explain which are offered and why, and show usable allowance information.
   Existing helpers remain convenient entry points. A model is added only after
   its access, data handling and budget are configured; this plan selects no new
   provider or model.
5. **Advance Python through a concrete academic task.** Choose one data or
   research activity and validate isolated server execution, admitted input files,
   inspectable code, artifact delivery and Stop. Follow the
   [execution architecture and acceptance criteria](execution.md). Keep its
   infrastructure work bounded to that activity and separate from the public
   browser. Student execution waits for the deployment checks below.
6. **Evaluate the complete experience before expanding integrations.** Compare
   the fork with existing WebbGPT and participants' usual tools where school
   permissions and data handling allow. Use results to retain, change or remove
   features. Selected OneDrive/SharePoint files are a possible next connector
   when an activity needs them; mailbox access is deferred.

## Current implementation and remaining work

| Area              | Existing baseline                                                                                      | Next work                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academic context  | Read-only per-user Canvas tools and picker; uploaded-document reading; source links and bounded reads. | Present assignment guidance, assistance choices and retrieval limits consistently in the complete activity.                                                                       |
| Chat and evidence | Native LibreChat helpers, activity, attachments, exports and school configuration.                     | Evaluate model choice and a reviewed AI-use summary. Neither is a completed new feature.                                                                                          |
| Public research   | Public URL reading, Brave search integration and a local rendered-page browser with Stop/restart.      | Validate source inspection and failure/cancellation behavior in study tasks. Live search requires the institution's configured key. Browser deployment isolation remains pending. |
| Python            | Developer terminal demonstration and documented server architecture.                                   | Implement and verify the isolated academic execution path and output-file delivery before student use.                                                                            |
| Microsoft         | Existing upstream file picker; read-only integration design. No configured school connection.          | Consider selected files after the initial activity study. Revisit mail only for a demonstrated need and a separate access review.                                                 |
| Operations        | Local prototype, policy controls and upstream management infrastructure.                               | Agree hosting, account admission, approved providers, budgets, content access, retention and maintenance responsibility.                                                          |

## Product and access boundaries

- Keep LibreChat's default visual language, chat and administration. Reuse its
  roles, profiles and sharing instead of adding a competing management system.
- Teacher assistance guidance is source material presented to the learner and
  model. It does not grant connector access or override institution policy.
  Enforce tool and source permissions on the server. The interface cannot
  guarantee compliance with an academic policy or control other AI apps.
- Connect each person's accounts explicitly and retrieve admitted sources on
  demand. Keep persistent personal memory off by default in the intended study
  profile. Define and disclose who can inspect stored conversations; an educator
  role does not automatically confer that access.
- Keep originals in Canvas, SharePoint/OneDrive or the person's normal document
  workflow. Use portable Markdown and images for generated working material.
  PDF and Word remain sources; no live Word editor or custom collaboration
  system is introduced.
- Research browsing remains public and bounded. Python receives no general
  network access or school-account credentials. Both need reliable cancellation
  and deployment isolation; the local demonstration is not that deployment.
- Exclude companion/therapy positioning, student behavior profiling, automated
  grading, AI detection and surveillance analytics. Preserve room for deliberate
  non-use and student choices about creative and personal work.
- Explain model use, allowances and tool activity. Discuss environmental concerns
  honestly without assigning unsupported water/carbon figures to individual chats.

## Study design and decisions

Start by discussing participation with two or three faculty members and roughly
12-20 students across different levels of AI experience. These are planning
targets, not recruited participants. Agree participation, permitted materials and
data handling with the school before collecting study records.

Use an assignment/study task, a reading/revision task and, when execution is
ready, a data/research task. Compare equivalent tasks under the same assistance
boundaries. Record observations with participant knowledge and retain only the
study information the school has agreed to collect.

Evaluate understanding through an explanation or follow-up attempt without the
assistant; inspect sources and calculations; ask whether assistance boundaries
and delegated work were clear. Also evaluate usefulness, task time, repeat-use
interest, teacher administration, technical failures and operating cost. Treat
opting out as useful feedback. This small study informs product decisions; it
does not establish a general causal learning benefit.

Before student use, verify account and source isolation, revocation, actual model
destinations, storage/deletion behavior and operator access. Any enabled browser
or Python workload also needs the dedicated-host, resource and teardown checks
in its technical plan. Keep a named maintenance owner and an agreed support path.

Use the findings to decide whether to continue developing this replacement
candidate, revise particular activities, or keep the existing service. Work for
other schools follows evidence from Webb rather than expanding the first study.

## Deferred work

Outlook/mailbox integration; additional GitHub/Slack connectors; authenticated
browser sessions and extensions; student-machine execution; general terminal
access for students; parallel-agent orchestration; shared-folder provisioning
and merging; a custom collaborative editor; and multi-school hosting remain
deferred. Microsoft sending and source writes remain excluded. Their earlier
designs stay available for reference, without becoming the next implementation
queue.
