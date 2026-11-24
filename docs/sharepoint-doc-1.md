# WebbGPT replacement candidate?

The idea of this project is to give people access to capable AI assistants through something the Webb can operate and manage, with connections to the materials and systems we already use. I'm particularly interested in assistants that can use tools: looking up an assignment, reading its attached documents, researching a question, or working through a calculation.

## What it could be useful for

Some examples of the experience I'm working towards:

- A student asks for help understanding an assignment. The assistant retrieves the instructions and rubric from their Canvas account, then helps them work through what is being asked.
- A teacher brings in a reading or draft lesson and asks for discussion questions, explanations, or feedback.
- Someone working with data asks the assistant to check a calculation or make a graph, with the code and results available to inspect.

Study coaching, writing feedback, and teaching preparation are starting points. What counts as useful or appropriate help is something I'd like us to explore together, particularly where assistance supports a student's understanding and where it starts doing the learning for them.

## What I'm building

The application is a fork of [LibreChat](https://www.librechat.ai/), an existing open-source chat application. That gives us a foundation for conversations, AI tools, file attachments, and account management. My work is focused on school integrations, institutional controls, and improvements to the student and educator experience.

Canvas would continue to manage courses and assignments; SharePoint and OneDrive would continue to hold documents. The assistant would help people work with those materials. Webb would choose which AI models, tools, and connections are available, and set rules for access and data handling. Model providers may still receive questions and retrieved material when answering them; Webb-operated does not automatically mean everything stays on Webb servers.

## Where it is now

There is a working local prototype with read-only Canvas access, document reading, web search, and limited public browser use. Next is a dashboard of upcoming assignments, with routes into course chats and projects that share assignment context across their conversations. Course folders would be generated after the user's permission, and invited collaborators could view a chat as it updates. This will support trying complete academic activities with clear guidance about permitted help and visible sources and tool results. Code execution has a development demonstration; a version suitable for student use still needs work. Selected OneDrive/SharePoint files are a possible later connection when an activity needs them. Email access is deferred; Microsoft connections remain subject to Webb review and permissions.

This is currently a development study. Hosting, privacy arrangements, and testing with educators all need further work before wider use.

### Where it could end up

If all goes well the intention is to make this a replacement of WebbGPT. If it goes even better this could be a generalisable platform for all schools. Then again this is only my proposal in the WebbGPT project/space.

[Code and project notes on GitHub](https://github.com/PatrickJYKang/school-agent)

[Current scope and development priorities](scope.md)

*— Patrick K*
