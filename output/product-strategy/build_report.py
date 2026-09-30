from pathlib import Path
from html import escape
import base64

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent

# Public product descriptions and proposed direction only. No customer records,
# unpublished documents, credentials, provider configuration, or internal costs.
competitors = []
def add(name, category, threat, job, price, response, sources):
    competitors.append(dict(name=name, category=category, threat=threat, job=job,
                            price=price, response=response, sources=sources))

add('Scite', 'Evidence and citation checks', 'Very high',
    'Smart Citations classify how later papers discuss a publication. Assistant links answers to source sentences. Reference Check examines manuscript references and publication notices; API, MCP and publisher relationships broaden its reach.',
    'Free Connect tier. Basic $14/month and Pro $35/month displayed with annual billing and a 30% sale ending 30 September 2026. These are promotional prices.',
    'Compete on the review of the writer’s exact sentence, evidence coverage, revision tracking and teacher-readable findings. Scite already sells verification. Its documented reference report and later-citation classifications do not by themselves establish whether every sentence in an arbitrary draft is faithful to its cited source. Test that distinction directly.',
    [('Product', 'https://scite.ai/'), ('Reference Check', 'https://scite.ai/blog/how-do-i-use-the-scite-reference-check'), ('Pricing', 'https://scite.ai/pricing')])
add('Grammarly', 'Writing and research suites', 'Very high',
    'Writing assistance, editor integrations and institutional distribution. Citation Finder scans factual claims, advertises verification, suggests web sources and inserts APA, MLA or Chicago citations.',
    'Free tier. US support lists Pro $30/member/month, or $144/member/year. Regional prices differ.',
    'A direct threat to source suggestions and claim checking, not merely a grammar competitor. Prove a measurable advantage on scholarly full-text evidence, contradictory context, precise locators and honest abstention. Integrate with existing editors rather than trying to outbuild its general writing tools.',
    [('Citation Finder guide', 'https://support.grammarly.com/hc/en-us/articles/38552451211533-Citation-Finder-user-guide'), ('US pricing', 'https://support.grammarly.com/hc/en-us/articles/115000090011-How-much-does-Grammarly-Pro-cost')])
add('Jenni', 'Writing and research suites', 'Very high',
    'Academic workspace for reading, writing and citing. Citation-aware autocomplete, source libraries, PDF chat, AI editing and document reviews. Its current positioning explicitly emphasizes tracing claims to sources.',
    'Free tier. Page displays Plus $12/month and Pro $29/month; monthly/annual toggle exists, but the extracted page does not establish which billing state produced these amounts.',
    'The strongest writing-first overlap. A traceable citation is already part of its pitch. Proof needs independent checking of existing prose and visible failure/coverage states, with better outcomes demonstrated on shared drafts.',
    [('Product', 'https://jenni.ai/'), ('Autocomplete', 'https://help.jenni.ai/docs/ai-tools/ai-autocomplete/'), ('Pricing', 'https://jenni.ai/pricing')])
add('Elicit', 'Research and synthesis', 'High',
    'Research agents, paper search, evidence extraction tables, reports and systematic review workflows. Documentation includes full-text screening and supporting quotes. Zotero import and exports fit established research workflows.',
    'Free Basic. Page shows Plus $11/user/month billed $132/year and one Pro configuration at $39/month billed $468/year; other Pro configurations show $49/month billed $588/year. Segment and checkout must be confirmed.',
    'A major threat if Proof moves into literature reviews. Keep the first product centered on existing-draft review. Build a useful evidence matrix later; avoid claiming exhaustive search or PRISMA readiness without a reproducible review protocol.',
    [('Pricing and features', 'https://elicit.com/pricing'), ('Workflow documentation', 'https://docs.elicit.com/')])
add('Consensus', 'Research and synthesis', 'High',
    'Research search with synthesized answers, Study Snapshots and Deep reviews. Its API and MCP make research retrieval available inside other assistants.',
    'Free tier. Pro $20/month or $144/year. Deep $65/month or $540/year. Team pricing varies.',
    'A strong answer-first substitute. Proof should start with a draft and its citations, keep unresolved evidence visible, and support revision review. Search and cited answers alone are not a distinctive suite.',
    [('Current plans', 'https://help.consensus.app/en/articles/10087865-subscription-plans'), ('MCP', 'https://docs.consensus.app/docs/mcp')])
add('SciSpace', 'Writing and research suites', 'High',
    'Broad platform for literature discovery, PDF chat, literature review, academic writing, paraphrasing and citation generation. Agent and template navigation also appears on its current pricing page.',
    'Paid plans and credits exist. Current numerical prices did not render in the accessible official pricing page; no amount asserted.',
    'It competes on suite breadth and researcher convenience. Proof should make evidence review its central workflow rather than assemble a similarly broad menu of AI tools.',
    [('Official features and pricing', 'https://scispace.com/pricing')])
add('Paperpal', 'Writing and research suites', 'Very high',
    'Academic writing, research and citation tools plus submission checks. Reference Checker parses manuscripts, matches citations and verifies reference metadata, validity, retractions and citation patterns.',
    'Prime $25/month or $144/year. Pro $59/month or $348/year, per its official help article.',
    'A serious competitor for a submission-ready suite. The documented reference-health workflow is adjacent to semantic claim support. Prove where Proof catches misuse of a real paper rather than just a broken or missing reference.',
    [('Reference Checker', 'https://support.paperpal.com/support/solutions/articles/3000137228-how-does-paperpal-s-reference-checker-work-'), ('Current pricing', 'https://support.paperpal.com/support/solutions/articles/3000126443-what-is-the-price-for-paperpal-paid-subscriptions-'), ('Product', 'https://paperpal.com/')])
add('Paperguide', 'Writing and research suites', 'High',
    'Integrated search, reference management, extraction, writing and systematic reviews. Offers collaboration, Zotero/Mendeley imports, institutional library access, API and MCP. Image/table extraction is labeled coming soon on the pricing page.',
    'Free tier; displayed Plus $19, Pro $49 and Evidence $149 per seat/month. The page has a billing toggle, so confirm billing state at checkout. Enterprise custom.',
    'One of the closest competitors to the proposed complete suite. Shared project data and auditable workflows are already sold here. Prioritize a simpler draft review and reliable claim decisions, then integrate with existing libraries.',
    [('Product', 'https://paperguide.ai/'), ('Pricing', 'https://paperguide.ai/pricing/')])
add('Undermind', 'Research and synthesis', 'High',
    'Conversational literature discovery, iterative reports, full-text exploration, custom tables, shared workspaces and research alerts. Supports use inside external AI agents.',
    'Free tier. Pro displayed at $16/month billed annually; Team $15/person/month billed annually. Academic/industry selection can affect the applicable offer.',
    'Strong for difficult discovery questions and ongoing monitoring. Integrate or benchmark discovery before replacing it. Make Proof’s alerts identify the exact reviewed claims affected by a new paper or publication notice.',
    [('Product and pricing', 'https://www.undermind.ai/')])
add('AnswerThis', 'Research and synthesis', 'High',
    'Research search, cited summaries, drafting and systematic-review workflows. The current pricing page markets shared reviews, dual-reviewer screening, evidence grading and reference-manager connectors.',
    'Free tier; academia Pro $35/seat/month billed monthly. Lab & Team displays $75/month billed annually with minimum three seats; the page does not clearly resolve the billing unit for that tier.',
    'Broad, fast-moving research-suite overlap. Treat its advanced-method claims as vendor descriptions. Compare actual exported evidence, reviewer control and error recovery in a task test.',
    [('Features and pricing', 'https://answerthis.io/our-pricing')])
add('Citely', 'Evidence and citation checks', 'Medium',
    'Source finding from claims or paragraphs and reference authenticity checks using scholarly databases. Focuses on fabricated citations and metadata consistency.',
    '$9 one-time trial. $19/month, or displayed $14/month billed yearly. Credit and character limits apply.',
    'Direct competition for “is this reference real?” and “find a source for this claim.” Differentiate by checking the meaning against accessible original evidence. Existence, relevance and support must remain separate findings.',
    [('Product and pricing', 'https://citely.ai/'), ('Claim-to-source workflow', 'https://citely.ai/source-finder-from-text')])
add('Cite Checker', 'Evidence and citation checks', 'Medium',
    'Free open-source bibliography verifier. Checks whether references exist and flags bibliographic problems; the site says PDFs remain local and extracted citation text is sent for verification.',
    'Free, no login required.',
    'Bibliographic verification is becoming a free utility. Bundle it into Proof and charge for reliable document review, preserved evidence and collaboration. No full semantic-draft audit was established from this page.',
    [('Official product', 'https://www.citechecker.app/en')])
add('Recite', 'Evidence and citation checks', 'Medium',
    'Checks that in-text citations and reference-list entries match. Paid features include retraction flags, DOI feedback and Crossref integration for specified styles.',
    'Limited free use. $8/month subscription or $80/year; $6 for three days of access.',
    'A simple, clear competitor for citation consistency. Proof needs the same clean matching behavior, but should explain separately whether the underlying claim is supported.',
    [('Product', 'https://reciteworks.com/'), ('Pricing', 'https://reciteworks.com/pricing')])
add('Trinka / Enago', 'Evidence and citation checks', 'High',
    'Academic writing and citation-quality reports covering retractions, unverified references, potential predatory journals, duplicates, age and journal overuse. Word integration and institutional offerings extend the suite.',
    'Basic and paid plans; citation checks use credits. Current numerical subscription prices were not available in the extracted official page.',
    'Competes directly on reference risk and submission readiness. A journal-risk flag should not be confused with a claim-support decision. Keep original passages, precise reasoning and incomplete checks visible.',
    [('Citation Checker', 'https://www.trinka.ai/features/citation-checker/'), ('Plans', 'https://www.trinka.ai/pricing/')])
add('Sourcely', 'Evidence and citation checks', 'Medium',
    'Source finding from writing, summaries, saved references, deep search, source chat and credibility checks. Also links a citation verification tool.',
    'Pricing page displays Ultra $19/month and Max $39/month beside a monthly/yearly toggle and annual-billing text; confirm the selected billing state.',
    'Close competition for filling missing citations. Proof should also search for challenges to a claim and make the limits of relevance scoring explicit.',
    [('Features and pricing', 'https://www.sourcely.net/pricing')])
add('Yomu', 'Writing and research suites', 'Medium',
    'Academic drafting, editing, PDF/image chat, source search, citation assistance and a plagiarism checker. Its FAQ describes generating paragraphs and sections.',
    'Pro $120/year, shown as $10/month; monthly price shown as $21. Ultra $204/year, shown as $17/month; monthly price shown as $35.',
    'Competes for students’ writing budgets. Keep assistance optional and source-linked, and sell review outcomes teachers can inspect rather than faster essay generation.',
    [('Official pricing and FAQ', 'https://www.yomu.ai/pricing')])
add('Writefull', 'Writing and research suites', 'Medium',
    'Academic language editing and rewriting in Word and Overleaf, including explanations and specialized research-writing feedback.',
    'Free quotas and paid Premium/group/institutional access. An unambiguous current billing amount was not confirmed.',
    'Useful integration or complementary language layer. Research-specific phrasing is already a mature category; rewriting must trigger fresh evidence checks whenever the claim changes.',
    [('Word product', 'https://www.writefull.com/writefull-for-word'), ('Overleaf guide', 'https://help.writefull.com/writefull-for-overleaf--user-guide'), ('Plans', 'https://my.writefull.com/')])
add('Papers AI', 'Writing and research suites', 'High',
    'Research workspace bringing Word, Markdown, LaTeX/Typst, code, Jupyter and references together. Markets local/offline work, collaboration, approve/reject AI edits and reference-manager connections. Distinct from the former Papers by ReadCube.',
    'Free plan. Plus £10/month billed monthly with a larger AI allowance.',
    'A warning against building a universal research editor as the first expansion. Multi-format authoring and approval-controlled edits are already offered. Build review integrations and evidence provenance before expensive editor breadth.',
    [('Product', 'https://dspace.writefull.com/'), ('Pricing', 'https://dspace.writefull.com/pricing')])
add('Scholarcy', 'Reading and discovery', 'Medium',
    'Structured article summaries, flashcards, notes, highlighting, collections, literature matrices and bibliographies.',
    'Free limited summarizer plus paid plans. Numerical paid prices failed to render on the official page.',
    'Summaries and reading help are useful but easy to substitute. Proof’s reader should connect selected passages to the claims that use them, preserving page and section locations.',
    [('Features and pricing', 'https://www.scholarcy.com/pricing')])
add('Zotero', 'Reference libraries', 'High substitute / partner',
    'Free open-source reference library, PDF annotation, group collaboration and citations inside Word, LibreOffice and Google Docs.',
    'Core software free. File sync: 300 MB free; 2 GB $20/year; 6 GB $60/year; unlimited $120/year.',
    'The first library integration. Do not force users to rebuild their reference collections. Import stable records and preserve annotations, then attach claim-level evidence and review history.',
    [('Product', 'https://www.zotero.org/'), ('Storage prices', 'https://www.zotero.org/storage')])
add('Mendeley', 'Reference libraries', 'Medium substitute / partner',
    'Free web/desktop reference management, PDF notes and annotations, shared references and Word bibliography creation through Mendeley Cite.',
    'Reference Manager is free; additional service/storage pricing not evaluated.',
    'Import and export rather than replace. Its installed libraries and Word workflow create switching costs even without a documented manuscript-wide claim audit.',
    [('Official guide', 'https://static.mendeley.com/md-stitch/releases/live/mendeley-reference-manager-introduction.eca1d332.html'), ('Word add-in', 'https://www.mendeley.com/reference-management/mendeley-cite')])
add('EndNote', 'Reference libraries', 'Medium substitute / partner',
    'Reference management, full-text retrieval, reference updates and discovery. EndNote 2025 adds AI tools and research recommendations.',
    'Official purchase page shows full license list price $275, discounted to $206; student $150, discounted to $113; upgrade $125, discounted to $94. One-time licenses, promotion subject to change.',
    'Respect institutional workflows and citation fields. Support RIS/BibTeX early, then evaluate a review add-in instead of replacing the manager.',
    [('Current purchase page', 'https://endnote.com/buy/')])
add('Paperpile', 'Reference libraries', 'Medium substitute / partner',
    'Reference and PDF management, citation styles, Word/Google Docs integrations, full-text search and shared libraries on higher plans.',
    'Annual billing only. Regular $8.30/month equivalent or $4.15 with academic discount; Expert $11.50 or $5.75 academically.',
    'Google Docs adoption is a distribution advantage. Provide evidence checks inside that workflow and transfer references without losing identifiers.',
    [('Official pricing and features', 'https://help.paperpile.com/pricing/')])
add('ResearchRabbit', 'Reading and discovery', 'Medium',
    'Citation-network discovery, related-paper browsing, saved collections and sharing. Free tier supports up to 50 seed papers; RR+ adds larger searches, advanced controls, projects and integrity alerts.',
    'Free tier. RR+ $12.50/month or $120/year, with country discounts.',
    'Use citation chasing as an input, not a claim verdict. Evidence-linked alerts could become a retention feature, but generic alerts are already offered here.',
    [('Pricing', 'https://www.researchrabbit.ai/pricing'), ('RR+ guide', 'https://learn.researchrabbit.ai/en/articles/12454495-what-is-researchrabbit')])
add('Litmaps', 'Reading and discovery', 'Medium',
    'Literature discovery maps, visualization, sharing and monitoring for new research.',
    'Free tier. Education Pro page shows $10/month with annual billing, $120/year; commercial, team and country terms vary. Extracted free-tier limits conflict, so no exact free quota asserted.',
    'A competitor for literature maps and alerts. Proof should make a map answer “which claim relies on which evidence?” before adding a decorative graph of papers.',
    [('Product', 'https://www.litmaps.com/'), ('Pricing', 'https://www.litmaps.com/pricing')])
add('Connected Papers', 'Reading and discovery', 'Medium',
    'Builds similarity graphs around an origin paper and helps locate related, prior and derivative work. Its graph is based on paper similarity, not simply a direct citation tree.',
    'Free/premium model described in its terms. Numerical current prices did not render in the official pricing page.',
    'A focused discovery tool with a clear visual job. Integrate links or exports; a network connection is not evidence that a draft’s assertion is correct.',
    [('How it works', 'https://www.connectedpapers.com/about'), ('Official terms', 'https://www.connectedpapers.com/terms'), ('Pricing', 'https://www.connectedpapers.com/pricing')])
add('Google Scholar', 'Reading and discovery', 'High baseline substitute',
    'Broad scholarly search spanning articles, books, theses and other academic material, with citation-based discovery and links to available versions.',
    'Public search is free.',
    'The default habit to beat. Demonstrate shorter time from a questionable sentence to an inspectable correction. Do not claim broader coverage without testing across fields.',
    [('Official overview', 'https://scholar.google.com/intl/en-gb/scholar/about.html')])
add('Semantic Scholar', 'Reading and discovery', 'High baseline / partner',
    'Free AI-assisted scholarly search, research feeds, academic graph APIs and Semantic Reader’s in-context citation information and annotations.',
    'Free research services; API access governed by its documentation and limits.',
    'A valuable retrieval and reading ecosystem. Search, a paper index and contextual reading are infrastructure; Proof’s value must be the reviewed relationship between a specific draft claim and the original evidence.',
    [('Official overview', 'https://webflow.semanticscholar.org/about/librarians'), ('Semantic Reader', 'https://webflow.semanticscholar.org/product/semantic-reader')])
add('Gemini Notebook, formerly NotebookLM', 'General AI substitutes', 'Very high',
    'Google renamed NotebookLM on 16 July 2026. Source-based research notebooks, document understanding, research discovery and cited outputs now extend across the Gemini ecosystem, with code/data analysis capabilities.',
    'Free access with limits; expanded access through eligible Google AI and Workspace plans. Exact local bundle price not asserted.',
    'A strong “upload papers and ask questions” substitute with built-in distribution. Proof should offer repeatable draft review, visible coverage and revision-specific evidence records. Source-grounded chat alone will be difficult to sell.',
    [('Rename and expansion', 'https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/'), ('Sources and free limits', 'https://support.google.com/gemininotebook/answer/16215270'), ('Work/school plans', 'https://support.google.com/gemininotebook/answer/16337734')])
add('ChatGPT Deep Research', 'General AI substitutes', 'Very high',
    'Researches the web, uploaded files, specified sites and eligible connected apps; produces documented reports with source links, downloadable formats and an activity history.',
    'Free and paid ChatGPT tiers with differing research allowances. The current extracted pricing page omitted numerical subscription amounts, so historical prices are not repeated.',
    'People may already pay for it. Proof must outperform a good document-audit prompt on the same tasks and produce durable, structured review records. An eventual API/MCP tool can reach users through their existing assistant.',
    [('Current research guide', 'https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt'), ('Plans', 'https://chatgpt.com/pricing/')])
add('Claude Research', 'General AI substitutes', 'High',
    'Agentic web research with cited answers, plus connected-app research through integrations. Research is documented for paid Pro, Max, Team and Enterprise plans.',
    'Paid plans required for Research in current help documentation. Current numerical prices not checked.',
    'An effective manuscript-analysis substitute and future integration channel. Compare claim extraction, evidence faithfulness, abstention and review time against a strong Claude workflow.',
    [('Current Research guide', 'https://support.claude.com/en/articles/11088861-use-research-on-claude'), ('Integrations', 'https://www.anthropic.com/news/integrations')])
add('Perplexity', 'General AI substitutes', 'High',
    'Cited search and Research, file analysis, projects, premium models and broader agent workflows. Education Pro targets verified students and educators.',
    'Free tier; Education Pro $10/month with verification. Enterprise Pro starts at $40/seat/month or $400/seat/year. Individual Pro amount not confirmed here.',
    'A source-discovery and report-generation substitute at a student-friendly price. A larger citation count is not a quality metric. Compare exact passage support and contradictions in the evidence.',
    [('Plan guide', 'https://www.perplexity.ai/help-center/en/articles/11187416-which-perplexity-subscription-plan-is-right-for-you'), ('Pro features', 'https://www.perplexity.ai/help-center/en/articles/10352901-what-is-perplexity-pro')])
add('Turnitin Feedback Studio / Clarity', 'Institutional review', 'Very high for school sales',
    'Institutional writing assessment and integrity workflows. Clarity provides a composition space, AI assistance and reports that make students’ writing process visible to instructors. It is a paid Feedback Studio add-on.',
    'Institutional licensing; no standard public individual price established.',
    'The major distribution and procurement obstacle for teacher review. Sell evidence literacy and source interpretation, not a competing misconduct score. Avoid replacing the LMS or recording every keystroke without a clear educational reason.',
    [('Clarity administrator FAQ', 'https://guides.turnitin.com/hc/en-us/articles/37670935742989-FAQs-for-administrators-using-Turnitin-Clarity'), ('Feedback Studio', 'https://www.turnitin.com/products/revision-assistant/')])
add('Scribbr', 'Institutional review', 'Medium',
    'Citation generation, APA citation checking and human citation editing. Its service explicitly distinguishes formatting from verifying the supplied reference information.',
    'APA checker $9.95. Human citation editing $2.75/source.',
    'Strong on final-submission anxiety and familiar student branding. Proof can combine format correction with exact source support, while keeping each result separate and reviewable.',
    [('Official checker and service boundaries', 'https://www.scribbr.com/citation/checker/')])
add('Penelope.ai', 'Institutional review', 'Medium',
    'Checks Word manuscripts against journal requirements, including structure, declarations, statistics and referencing; offers configurable checks and commented documents.',
    'Current numerical commercial price not verified.',
    'Relevant to a publisher expansion. Journal-specific submission checks are an established product, so add them only when evidence review creates a clear reason for an editor to adopt Proof.',
    [('Official product', 'https://www.penelope.ai/-index')])
add('Covidence', 'Systematic review platforms', 'High for advanced research',
    'Collaborative systematic review management, screening, extraction and review workflows, with institutional adoption and reference-manager imports.',
    'Single review $339/year with unlimited collaborators for 12 months. Package of up to three reviews $907/year. Institutional licenses custom; trial available.',
    'A different level of workflow rigor from an essay checker. Protocols, independent reviewers, exclusions and reproducible screening are required before Proof competes for systematic reviews.',
    [('Product workflow', 'https://get.covidence.org/systematic-review-software'), ('Current pricing page', 'https://www.covidence.org/pricing/')])
add('Rayyan', 'Systematic review platforms', 'High for advanced research',
    'Collaborative review screening, duplicate detection, AI relevance predictions and PICO extraction. Higher plans offer ResearchPilot, institutional controls and API access.',
    'Free plan. Advanced displayed at $8.33/seat/month billed annually. Business/Academic displayed at $41.67/license/month billed annually, starting with five licenses. Academic discounts apply.',
    'Competes on structured evidence-review workflow and research team budgets. Avoid superficial “systematic review” branding before building screening decisions and reviewer adjudication.',
    [('Official pricing and features', 'https://www.rayyan.ai/pricing')])
add('DistillerSR', 'Systematic review platforms', 'High for enterprise expansion',
    'Auditable evidence-management platform with screening, extraction from text/tables, reusable evidence, versioned decisions, configurable workflows and reporting.',
    'Enterprise sales; no standard numerical price verified.',
    'Evidence traceability and reusable evidence are already enterprise categories. Proof’s later opportunity would need a narrower use case and better adoption economics, not the claim that no one has an evidence record.',
    [('Official platform', 'https://www.distillersr.com/products/distillersr-systematic-review-software')])
add('RefVerifier', 'Research prototypes and open source', 'High concept overlap',
    'September 2026 research prototype extracts citation-bearing sentences, checks metadata, resolves open-access papers, locates passages and proposes claim verdicts for reviewers. The authors report 71% end-to-end verdict accuracy on eight manuscripts.',
    'Research prototype, not a verified commercial subscription. No product price established.',
    'The clearest direct technical overlap. It means the mechanism is not unique. Treat the small author-reported study as evidence of difficulty, not a comparable accuracy score for Proof. Inspect the implementation and benchmark against it where feasible.',
    [('Paper and reported evaluation', 'https://arxiv.org/abs/2609.07652')])
add('RefChecker', 'Research prototypes and open source', 'Medium technology substitute',
    'Open-source fine-grained hallucination-checking pipeline and benchmark from Amazon Science. Extracts claims and compares them with reference content using configurable models.',
    'Open-source software; running models and retrieval still costs money.',
    'A foundation or baseline for verification rather than a full student suite. The classifier alone is not a defensible advantage; evidence acquisition, document handling, evaluation and user workflow matter.',
    [('Official repository', 'https://github.com/amazon-science/RefChecker'), ('Research paper', 'https://arxiv.org/abs/2405.14486')])

def links(items):
    return ' · '.join(f'<a href="{escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(label)}</a>' for label, url in items)

def font_css():
    css = ''
    for family, file in [('Proof Sans', 'dm-sans/files/dm-sans-latin-400-normal.woff2'),
                         ('Proof Display', 'newsreader/files/newsreader-latin-400-normal.woff2')]:
        path = ROOT / 'node_modules/@fontsource' / file
        if path.exists():
            data = base64.b64encode(path.read_bytes()).decode()
            css += f'@font-face{{font-family:"{family}";src:url(data:font/woff2;base64,{data}) format("woff2");font-style:normal;font-weight:400;font-display:swap;}}'
    return css

rows = ''.join(f'<tr><th scope="row"><a href="#competitor-{i}">{escape(c["name"])}</a></th><td>{escape(c["category"])}</td><td>{escape(c["threat"])}</td><td>{escape(c["price"])}</td></tr>' for i,c in enumerate(competitors))
directory = ''.join(f'''<details class="competitor" id="competitor-{i}">
<summary><span><strong>{escape(c['name'])}</strong><small>{escape(c['category'])}</small></span><span class="threat">{escape(c['threat'])}</span></summary>
<div class="detail-body"><p>{escape(c['job'])}</p><p class="price">{escape(c['price'])}</p><p><strong>Implication for Proof.</strong> {escape(c['response'])}</p><p class="sources">{links(c['sources'])}</p></div>
</details>''' for i,c in enumerate(competitors))

html = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="A sourced proposal for extending Proof into a research and writing suite, with 40 competitor profiles and a staged roadmap.">
<title>Proof | Suite direction and competition</title>
<style>FONT_CSS
:root{--ink:#1d3027;--muted:#5c6d63;--green:#245c48;--dark:#174533;--tint:#e7efe9;--paper:#fafbf9;--line:#dce5df;--amber:#805322;--blue:#3d6382;--red:#9b4545}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:26px}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Proof Sans",Arial,sans-serif;font-size:16px;line-height:1.65}a{color:var(--green);text-decoration-thickness:1px;text-underline-offset:4px}a:hover{color:var(--dark)}a:focus-visible,summary:focus-visible{outline:3px solid #8fc5ab;outline-offset:5px;border-radius:3px}h1,h2,h3,p{margin-top:0}h1,h2{font-family:"Proof Display",Georgia,serif;font-weight:400;line-height:1.08;letter-spacing:-.035em}h1{font-size:clamp(44px,6vw,80px);max-width:850px;margin-bottom:28px}h2{font-size:clamp(34px,4vw,48px);margin-bottom:26px}h3{font-size:21px;line-height:1.35;letter-spacing:-.025em;margin-bottom:12px}p{margin-bottom:18px}strong{font-weight:700}small,.small{font-size:13px;color:var(--muted)}.shell{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1600px;margin:auto}.side{position:sticky;top:0;align-self:start;height:100vh;padding:38px 25px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:30px}.brand{font-family:"Proof Display",Georgia,serif;font-size:42px;line-height:1;letter-spacing:-2px;text-decoration:none}.side nav{display:grid;gap:14px}.side nav a{font-size:14px;text-decoration:none;color:var(--muted)}.side nav a:hover{color:var(--green)}.side .edition{margin-top:auto;font-size:12px;line-height:1.6;color:var(--muted)}main{padding:60px clamp(24px,5vw,84px) 80px;min-width:0}.meta{display:flex;gap:15px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:34px}.meta span+span{border-left:1px solid var(--line);padding-left:15px}.lead{font-size:21px;line-height:1.6;max-width:810px}.thesis{padding:28px 32px;background:var(--tint);border-left:4px solid var(--green);margin:32px 0 26px;font-size:20px;line-height:1.55}.thesis p:last-child{margin:0}.note{background:#f3f7f4;border:1px solid var(--line);border-radius:12px;padding:20px 24px;color:var(--muted);font-size:14px}.section{padding-top:60px;margin-top:52px;border-top:1px solid var(--line)}.section-intro{max-width:850px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.card{background:white;border:1px solid var(--line);border-radius:14px;padding:25px}.card p:last-child{margin-bottom:0}.card .sources{margin-top:16px}.sources{font-size:12px;color:var(--muted);line-height:1.65}.sources a{color:var(--muted)}.wide{grid-column:1/-1}.status{display:inline-block;font-size:12px;color:var(--green);background:var(--tint);padding:3px 9px;border-radius:20px;margin-bottom:13px}.status.later{color:var(--blue);background:#edf2f7}.status.quality{color:var(--amber);background:#f7f0e8}.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:30px 0}.flow div{padding:19px 16px;border:1px solid var(--line);border-radius:12px;background:white}.flow strong{display:block;font-size:15px;margin-bottom:7px}.flow span{font-size:13px;color:var(--muted)}.evidence-record{margin:28px 0;background:var(--ink);color:white;border-radius:18px;padding:30px}.record-grid{display:grid;grid-template-columns:1.1fr .35fr 1.2fr;align-items:center;gap:18px}.record-claim{font-family:"Proof Display",Georgia,serif;font-size:27px;line-height:1.3}.record-arrow{text-align:center;font-size:35px;color:#8fc5ab}.record-source{border-left:2px solid #8fc5ab;padding-left:20px;font-size:16px}.record-source p{margin-bottom:8px}.evidence-record small{color:#bdd0c4}.record-footer{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px;padding-top:20px;border-top:1px solid #435b4d;font-size:12px;color:#bdd0c4}.record-footer span{border:1px solid #435b4d;border-radius:6px;padding:4px 9px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:white;margin:26px 0}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:16px 18px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}thead th{background:#eef4ef;color:var(--muted);font-size:12px;font-weight:400}tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}tbody th{min-width:150px;font-size:15px}td{min-width:135px}td:last-child{min-width:280px}ul,ol{padding-left:21px;margin:14px 0 20px}li{padding-left:3px;margin:8px 0}.phase{display:grid;grid-template-columns:170px minmax(0,1fr);border-top:1px solid var(--line);padding:28px 0;gap:24px}.phase:first-child{border-top:0}.phase-time{font-family:"Proof Display",Georgia,serif;font-size:28px;line-height:1.2}.phase-time small{display:block;font-family:"Proof Sans",Arial,sans-serif;letter-spacing:0;margin-top:9px}.gate{background:var(--tint);padding:13px 17px;border-radius:8px;font-size:14px}.competitor{border-top:1px solid var(--line);background:white}.competitor:last-child{border-bottom:1px solid var(--line)}.competitor summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:22px 20px}.competitor summary::-webkit-details-marker{display:none}.competitor summary strong{font-size:19px;display:block}.competitor summary small{display:block;margin-top:4px}.competitor summary:after{content:'+';font-size:25px;color:var(--muted)}.competitor[open] summary:after{content:'−'}.competitor[open]{background:#f3f7f4}.threat{margin-left:auto;font-size:12px;color:var(--muted);text-align:right;max-width:150px}.detail-body{padding:0 24px 25px;max-width:940px}.detail-body .price{font-size:14px;border-left:3px solid #b0cdb9;padding-left:15px;color:var(--muted)}.overview td:last-child{max-width:410px}.checklist{counter-reset:checks}.checklist li::marker{color:var(--green)}footer{border-top:1px solid var(--line);padding-top:24px;margin-top:60px;color:var(--muted);font-size:13px}.skip{position:absolute;left:20px;top:-100px;background:white;padding:10px}.skip:focus{top:10px;z-index:20}.no-break{white-space:nowrap}
@media(max-width:1100px){.shell{grid-template-columns:190px minmax(0,1fr)}.side{padding:30px 20px}.flow{grid-template-columns:repeat(3,1fr)}}
@media(max-width:760px){html{scroll-padding-top:20px}.shell{display:block}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:22px;gap:20px}.side nav{display:flex;overflow:auto;gap:22px;padding-bottom:5px}.side nav a{white-space:nowrap}.side .edition{display:none}.brand{font-size:34px}main{padding:34px 22px 50px}.meta{margin-bottom:28px;font-size:12px}.lead{font-size:18px}.thesis{padding:20px;font-size:18px}.section{padding-top:38px;margin-top:36px}.grid{grid-template-columns:1fr}.card{padding:22px}.wide{grid-column:auto}.flow{grid-template-columns:1fr 1fr}.record-grid{grid-template-columns:1fr}.record-arrow{text-align:left;font-size:26px;transform:rotate(90deg);width:30px;margin:0 0 4px 10px}.record-source{padding-left:15px}.evidence-record{padding:23px}.record-claim{font-size:25px}.phase{grid-template-columns:1fr;gap:16px}.phase-time{font-size:27px}.competitor summary{padding:20px 12px;gap:12px}.competitor summary strong{font-size:17px}.detail-body{padding:0 15px 24px}.threat{max-width:105px;font-size:11px}.table-wrap{border-radius:8px}th,td{padding:13px 14px}.sources{overflow-wrap:anywhere}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{.side,.skip{display:none}.shell{display:block}main{padding:0}.section{break-before:auto;padding-top:26px;margin-top:26px}.card,.evidence-record{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:10px}th,td{min-width:0!important;padding:7px}.competitor summary{padding:12px}details::details-content{display:block!important}a{color:var(--ink)}body{font-size:12px}.sources{font-size:10px}.record-grid{display:block}.record-arrow{display:none}h1{font-size:48px}h2{font-size:30px}}
</style></head><body>
<a class="skip" href="#main">Skip to report</a>
<div class="shell"><aside class="side"><a class="brand" href="#main">Proof.</a><nav aria-label="Report sections">
<a href="#direction">Recommended direction</a><a href="#suite">The full suite</a><a href="#competition">Competition</a><a href="#directory">40 product profiles</a><a href="#advantage">How Proof could win</a><a href="#roadmap">Build sequence</a><a href="#business">Customers and pricing</a><a href="#validation">What to test next</a><a href="#method">Research notes</a>
</nav><div class="edition">30 September 2026<br>Public research edition<br>Proposed features are labeled.</div></aside>
<main id="main"><header><div class="meta"><span>Product direction</span><span>Competition research</span><span>30 September 2026</span></div>
<h1>A research and writing suite that keeps claims tied to evidence.</h1>
<p class="lead">Proof can grow into the workspace where someone finds research, reads it, builds an argument, writes a draft and checks whether the finished text is faithful to its sources. The evidence check should connect every part of the suite.</p>
<div class="thesis"><p>My recommendation is to start with <strong>the final review of an existing draft</strong>, then expand into the work that makes that review easier and more useful. Own the moment when a writer asks, “Does the evidence actually support this?”</p></div>
<p class="small">40 selected products, platforms and research projects. This is a broad competitive map, not an exhaustive census or a hands-on accuracy ranking.</p></header>

<section class="section" id="direction"><h2>The direction I would choose</h2>
<div class="section-intro"><p>Build an evidence-centered research and writing suite for students and academic writers. Begin with a clear promise: <strong>check the claims in your draft, show the original evidence and explain what still needs a human review.</strong> This gives each later feature a concrete purpose.</p>
<p>The market already has capable writing tools, paper chat, source search, reference libraries and submission checkers. Proof does not have an uncontested category. The opportunity is to deliver a review that people understand, trust appropriately and return to after revising.</p></div>
<div class="table-wrap"><table><thead><tr><th>Possible direction</th><th>What you build</th><th>Tradeoff</th></tr></thead><tbody>
<tr><th>Focused draft reviewer</th><td>Import a draft, check its claims and citations, resolve findings and export the review.</td><td>Fastest route to a clear paid use case. Usage may cluster around deadlines.</td></tr>
<tr><th>Academic research and writing suite</th><td>Shared library, reader, evidence notes, writing, citations and review in one project.</td><td>More recurring value and a larger product. Direct overlap with established suites and more integration work.</td></tr>
<tr><th>Evidence-checking infrastructure</th><td>An API and assistant tools that return claim verdicts, passages, locations and coverage.</td><td>Can reach other products’ users. Requires developer adoption, clear reliability commitments and usage economics.</td></tr>
</tbody></table></div><p>I would choose the academic suite as the destination, deliver the focused reviewer first and open an API once the evidence workflow is stable. That sequence tests the central value before committing to an entire editor.</p>
<div class="grid"><article class="card"><h3>Start with students and teachers</h3><p>Students have a concrete deadline and teachers can judge whether a flagged claim actually needs correction. Supervised pilots can reveal both errors and confusing feedback. The product should teach source interpretation while helping the student finish the work.</p><p>Individual students are seasonal buyers. Teacher adoption is a distribution hypothesis worth testing early, but institution-wide sales require a separate product and procurement effort.</p></article>
<article class="card"><h3>Expand into research teams later</h3><p>Graduate researchers, lab writers and editors have longer documents and recurring review needs. They also need stronger full-text access, support for complex references, collaboration and evaluation across disciplines.</p><p>A verified student workflow does not prove readiness for scientific peer review or regulated evidence synthesis. Those should have their own adoption and reliability gates.</p></article></div>
<div class="note" style="margin-top:24px"><strong>Current baseline.</strong> The local project documentation describes draft import, source discovery, evidence comparison, inspectable findings and MLA tools, with a class workflow. It also documents restricted source eligibility, extraction limits and manual review needs. This report treats that as a prototype baseline, not proof of production accuracy or a complete research suite. All expansions below are proposals.</div>
</section>

<section class="section" id="suite"><h2>What the full suite should contain</h2>
<p class="section-intro">One project should hold the research question, source library, notes, draft, citations and review history. A claim must retain its connection to evidence as the document changes. These are views of the same work, rather than separate tools that require repeated uploads.</p>
<div class="flow" aria-label="Proposed connected workflow"><div><strong>Research</strong><span>Find relevant and challenging papers.</span></div><div><strong>Read</strong><span>Save passages with exact locations.</span></div><div><strong>Write</strong><span>Build an argument from the evidence.</span></div><div><strong>Check</strong><span>Review claims and their cited sources.</span></div><div><strong>Share</strong><span>Resolve findings and export a review record.</span></div></div>
<div class="grid">
<article class="card"><span class="status quality">First priority</span><h3>Check</h3><p>Detect unsupported assertions, exaggerated conclusions, wrong populations or time periods, causal language that exceeds the study, numerical mismatches and quotations taken out of context. Treat reference identity and citation style as separate checks.</p><p>Show the exact claim, original passage, location, source version, coverage and reason. Distinguish supported-by-checked-evidence, contradicted, insufficient evidence, inaccessible and incomplete. A failed lookup must not produce a reassuring pass.</p></article>
<article class="card"><span class="status">Early expansion</span><h3>Library</h3><p>Persistent projects, DOI resolution, duplicate detection, PDF storage, tags, notes and saved passages. Start with Zotero import and RIS/BibTeX export. Keep institutional library access and legitimate user-supplied full text separate from open-web retrieval.</p><p>Retain original files and source versions where rights permit. A library item should show where it is used in the draft and which findings rely on it.</p></article>
<article class="card"><span class="status">Early expansion</span><h3>Read</h3><p>A reader with anchored highlights, printed-page mapping, methods and limitations views, searchable extracted text and questions answered from visible passages. Save a passage directly to an evidence note and connect it to a draft sentence.</p><p>OCR, multi-column PDFs, figures and tables need distinct extraction checks. A successful text extraction cannot stand in for a review of image-only content.</p></article>
<article class="card"><span class="status">Early expansion</span><h3>Research</h3><p>Find papers for a research question or a flagged claim. Show why each result is relevant, what source material is available, and whether it challenges or supports the assertion. Preserve the search query and selection decisions.</p><p>Search for counterevidence deliberately. Keep ordinary discovery separate from systematic-review mode, which requires protocols, screening records and explicit exclusions.</p></article>
<article class="card"><span class="status">Early expansion</span><h3>Cite</h3><p>Use an established citation-style processor for APA, MLA, Chicago and later field-specific styles. Validate metadata, resolve citation/reference mismatches, detect duplicates and offer style previews.</p><p>Never invent page numbers. Keep class-specific rules separate from standard styles. A perfectly formatted citation can still accompany an unsupported statement.</p></article>
<article class="card"><span class="status later">After the checker proves useful</span><h3>Write</h3><p>Start with an evidence outline, claim-to-source notes and a lightweight editor or Google Docs/Word review panel. Give feedback on argument gaps, conflicting sources and whether language exceeds the evidence.</p><p>Optional source-grounded drafting and language edits can follow. Generated text stays labeled; users approve changes. Changing a claim invalidates its old evidence judgment and triggers another check.</p></article>
<article class="card"><span class="status later">After individual adoption</span><h3>Review with others</h3><p>Students share a review record with a teacher. Research teams assign findings, comment, mark disagreements and document resolutions. Reviewers inspect the original evidence and the writer’s response.</p><p>Keep assignment checks, evidence findings and grading separate. A teacher dashboard should support learning and feedback, not quietly convert an uncertain model judgment into a misconduct accusation.</p></article>
<article class="card"><span class="status later">Retention and distribution</span><h3>Monitor and connect</h3><p>Browser capture, Zotero integration, Word/Google Docs checks, then API/MCP access. Later, alert users when a source is corrected or retracted, or when a relevant new study affects a reviewed claim.</p><p>Make an alert name the affected sentence and source. Generic new-paper notifications already exist in several competing products.</p></article>
</div>
<div class="evidence-record"><div class="record-grid"><div class="record-claim">“The treatment improves outcomes for all adults.”<br><small>Illustrative draft claim</small></div><div class="record-arrow" aria-hidden="true">→</div><div class="record-source"><p>The study covers a narrower participant group. Its conclusion does not establish the effect for all adults.</p><small>Illustrative finding, not a statement about a real study</small></div></div><div class="record-footer"><span>Draft version</span><span>Source identity</span><span>Original passage and locator</span><span>Checked sections</span><span>Reason and uncertainty</span><span>Reviewer decision</span></div></div>
<p class="small">The shared record is the important product structure. Search, reading, drafting, citations and collaboration should all add to it or use it.</p>
</section>

<section class="section" id="competition"><h2>The competition is converging</h2><p class="section-intro">The hardest competitors are crossing category boundaries. Grammarly advertises claim verification. Jenni emphasizes source-traceable writing. Scite offers source-linked answers and citation analysis. Paperguide sells an integrated research suite. Google and general assistants make source-based research available inside products people already use.</p>
<div class="grid">
<article class="card"><h3>Scite has the strongest evidence positioning</h3><p>Its publisher access and citation-context data are assets that a new app cannot recreate by adding another model call. Reference Check and source-linked answers overlap with Proof’s promise.</p><p><strong>Strategic judgment.</strong> Prove that reviewing the writer’s precise assertion, preserving uncertain cases and tracking revisions produces a better result. Do not market Proof as the only verification tool.</p><p class="sources"><a href="https://scite.ai/">Scite product</a> · <a href="https://scite.ai/blog/how-do-i-use-the-scite-reference-check">Reference Check</a></p></article>
<article class="card"><h3>Grammarly can make checking a default habit</h3><p>Citation Finder says it scans factual claims, verifies them, proposes sources and inserts formatted citations. It is available through Grammarly’s existing writing environment.</p><p><strong>Strategic judgment.</strong> Proof must demonstrate more rigorous scholarly evidence review and more useful explanations. “Grammarly checks grammar; Proof checks facts” is already an inaccurate comparison.</p><p class="sources"><a href="https://support.grammarly.com/hc/en-us/articles/38552451211533-Citation-Finder-user-guide">Citation Finder guide</a></p></article>
<article class="card"><h3>Jenni and Papers AI compete for the workspace</h3><p>Jenni combines academic writing, citations and reviews. Papers AI combines authoring, code, references and user-approved edits across multiple formats.</p><p><strong>Strategic judgment.</strong> A full editor is an expensive place to compete. Give users a review worth importing into their existing editor before asking them to move their writing.</p><p class="sources"><a href="https://jenni.ai/">Jenni</a> · <a href="https://dspace.writefull.com/">Papers AI</a></p></article>
<article class="card"><h3>Elicit, Consensus and Paperguide own research workflows</h3><p>They offer research retrieval, synthesis and structured evidence features. Elicit and Paperguide also document systematic-review workflows.</p><p><strong>Strategic judgment.</strong> A search box and literature summary are insufficient reasons to switch. Connect the results to the user’s existing draft and make corrections inspectable.</p><p class="sources"><a href="https://elicit.com/pricing">Elicit</a> · <a href="https://help.consensus.app/en/articles/10087865-subscription-plans">Consensus</a> · <a href="https://paperguide.ai/">Paperguide</a></p></article>
<article class="card"><h3>Turnitin is the school-sales obstacle</h3><p>Clarity already combines a writing space, AI assistance and teacher visibility into writing processes. It reaches schools through Feedback Studio and LMS workflows.</p><p><strong>Strategic judgment.</strong> A teacher needs a reason to add Proof. Test better source interpretation and reduced evidence-review time; do not assume schools want another integrity score.</p><p class="sources"><a href="https://guides.turnitin.com/hc/en-us/articles/37670935742989-FAQs-for-administrators-using-Turnitin-Clarity">Clarity FAQ</a></p></article>
<article class="card"><h3>The core mechanism is reproducible</h3><p>RefVerifier describes manuscript claim extraction, reference resolution, passage retrieval and verdict generation. RefChecker provides an open checking pipeline.</p><p><strong>Strategic judgment.</strong> A model prompt is weak protection. The defensible work is gathering the right evidence, locating it faithfully, measuring errors and fitting the review into a recurring workflow.</p><p class="sources"><a href="https://arxiv.org/abs/2609.07652">RefVerifier paper</a> · <a href="https://github.com/amazon-science/RefChecker">RefChecker repository</a></p></article>
</div>
<h3 style="margin-top:35px">The alternative is often a stack of existing tools</h3><p>A writer can combine Google Scholar or Consensus, a Zotero library, Gemini Notebook for reading, a general assistant for drafting, and Grammarly or Scribbr for final checks. Several components are free or already included in a subscription. Proof must save measurable review time or catch consequential errors that this workflow misses.</p>
<p class="sources"><a href="https://scholar.google.com/intl/en-gb/scholar/about.html">Google Scholar</a> · <a href="https://www.zotero.org/">Zotero</a> · <a href="https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/">Gemini Notebook</a> · <a href="https://www.scribbr.com/citation/checker/">Scribbr</a></p>
<div class="note" style="margin-top:22px"><strong>Five different checks.</strong> Citation formatting, reference existence, source identity, passage support and wider scientific validity answer different questions. A real paper may not support the sentence. A supporting passage may come from a weak study. Peer review and journal indexing do not certify the conclusion. The suite should display these differences rather than compress them into a single “verified” badge.</div>
</section>

<section class="section" id="directory"><h2>40 competitor profiles</h2><p>Threat levels are my strategic assessment of overlap with the proposed suite. They are not accuracy scores. Officially described features appear in each profile; the implications for Proof are analysis. Prices are a 30 September 2026 snapshot, with billing and extraction ambiguities retained.</p>
<div class="table-wrap"><table class="overview"><caption class="small" style="padding:16px;text-align:left">Click a product name for its full profile and official sources.</caption><thead><tr><th scope="col">Product</th><th scope="col">Main category</th><th scope="col">Overlap assessment</th><th scope="col">Verified price context</th></tr></thead><tbody>COMPETITOR_ROWS</tbody></table></div>
<p class="small">Expand a profile to see what it does, how it competes with Proof and the source links. Product names in the table jump to the corresponding profile.</p>
COMPETITOR_DIRECTORY
</section>

<section class="section" id="advantage"><h2>Where Proof could earn an advantage</h2><p class="section-intro">These are opportunities to prove, not advantages the prototype already owns. Competing products also have source citations, traces, uncertainty features and reviewer controls. The difference needs to appear in the quality and usefulness of a completed review.</p>
<div class="table-wrap"><table><thead><tr><th>Potential advantage</th><th>Concrete behavior</th><th>Evidence that it matters</th></tr></thead><tbody>
<tr><th>Precise evidence review</th><td>Match the sentence’s population, quantity, timeframe and causal strength to original evidence and relevant context.</td><td>Human-adjudicated errors caught that a reference-existence check and strong general-assistant prompt miss.</td></tr>
<tr><th>Honest coverage</th><td>Show claims detected, claims checked, source access failures, extraction gaps and human-only checks separately.</td><td>Users correctly understand what a report establishes and do not read incomplete coverage as a pass.</td></tr>
<tr><th>Review that survives revision</th><td>Preserve source versions and reviewer decisions; invalidate changed claims; recheck affected evidence links.</td><td>Writers return after edits and reviewers spend less time repeating work.</td></tr>
<tr><th>Teaching source use</th><td>Explain why a claim overstates a study and let the student correct it while the teacher can inspect the evidence.</td><td>Improved source interpretation on new examples and recurring teacher use without extra grading burden.</td></tr>
<tr><th>Evidence reuse</th><td>Attach reviewed passages to claims and carry them into later projects with status and provenance intact.</td><td>Faster repeat work, reliable retrieval and retention across assignments.</td></tr>
<tr><th>Convenient access</th><td>Use existing libraries and editors; preserve citation fields and original document formatting.</td><td>Low import failure rate, lower abandonment and more second reviews.</td></tr>
</tbody></table></div>
<h3>What could make this defensible</h3><p>A diverse, permissioned evaluation set with human-adjudicated claim/source pairs; dependable parsing and evidence locators; accumulated review history; institutional distribution; and legitimate access to more of the literature. A feedback loop should collect approved error reports and adjudications, not silently train on private essays or copyrighted full text.</p>
<h3>What I would avoid building now</h3><ul><li>A universal document editor, a general chat assistant or a large menu of unrelated AI tools.</li><li>A global “truth score,” guaranteed accuracy claims, automatic factual rewrites or invented page locators.</li><li>AI detection or “humanizing” as the central product. Evidence checking and authorship detection are different jobs.</li><li>Clinical guidance, legal research or regulatory-grade evidence synthesis before domain-specific validation and workflows.</li><li>Exhaustive literature-review claims based on a small search result set. Show the searched sources and coverage instead.</li></ul>
</section>

<section class="section" id="roadmap"><h2>Build the suite in stages</h2><p>Illustrative sequence for a small team, subject to access, document handling and validation work. The time windows are planning estimates. Each stage should earn the next one through actual use.</p>
<div class="phase"><div class="phase-time">Weeks 1–4<small>Make the check dependable</small></div><div><h3>Review reliability and usable reports</h3><p>Improve claim extraction and citation mapping. Separate support, contradiction, inaccessible and incomplete states. Track source versions, extraction coverage and page/section locations. Add publication-notice checks and an independent evaluation set. Make the report readable without an expert explaining it.</p><p>Test imports, long documents, ambiguous references and interrupted jobs. Preserve every input and review decision needed to reproduce a finding.</p><div class="gate"><strong>Proceed when</strong> adjudicated reviews identify useful errors, coverage is clear, and the chosen false-clearance target holds on an unseen test set. Agree the threshold before evaluation; do not tune it on the test set.</div></div></div>
<div class="phase"><div class="phase-time">Weeks 5–8<small>Make projects persistent</small></div><div><h3>Library, reader and better citations</h3><p>Persistent projects, saved originals where permitted, DOI resolution, deduplication, evidence notes, Zotero/RIS/BibTeX import and exports. Add an established citation-style processor and reliable locators. Preserve the document’s connection to its sources across sessions.</p><div class="gate"><strong>Proceed when</strong> pilot users reopen projects, reuse saved evidence and complete a second review with less repeated setup.</div></div></div>
<div class="phase"><div class="phase-time">Weeks 9–12<small>Reach the existing workflow</small></div><div><h3>One editor connection and small team pilots</h3><p>Choose Google Docs or Word based on observed pilot use. Start with read-only checks and explicit edit previews. Add shareable reports, reviewer comments and a compact teacher view. Search from a flagged claim and retain the selected source.</p><div class="gate"><strong>Proceed when</strong> users willingly pay or an institution funds a recurring pilot, reviewers resolve findings faster, and integration failures do not consume the time saved.</div></div></div>
<div class="phase"><div class="phase-time">Months 4–6<small>Broaden only after adoption</small></div><div><h3>Research workspace and collaborative revision</h3><p>Evidence matrices, argument outlines, source-grounded drafting, change-aware rechecks and team assignments. Expand source access by field. Introduce clear project permissions, institutional sign-in, retention controls and support processes when customer needs justify them.</p><div class="gate"><strong>Proceed when</strong> there is recurring use beyond submission week and a measured advantage over the strongest competing workflow.</div></div></div>
<div class="phase"><div class="phase-time">Months 6–12<small>Optional expansion</small></div><div><h3>Monitoring, API and specialized review</h3><p>Claim-specific research alerts, publication-change monitoring, external-assistant tools and a verification API. Consider publisher prechecks or systematic-review support as distinct offers with domain-specific evaluation, evidence rights and reviewer workflows.</p><div class="gate"><strong>Proceed when</strong> a repeat customer problem supports the extension. Do not treat every adjacent market as another tab to add.</div></div></div>
<h3 style="margin-top:30px">The technical work behind the suite</h3><div class="grid"><article class="card"><h3>A shared evidence record</h3><p>Store Project → Document version → Claim → Citation → Source version → Passage → Judgment → Reviewer decision. Keep content hashes, identifiers, extraction locations, checked coverage, model/version metadata and decision timestamps. Record relationships in a normal database before considering a specialized graph store.</p><p>Changes to claim text, source text or checking policy should invalidate only the affected decisions. Exports need enough provenance to inspect and reproduce the review.</p></article><article class="card"><h3>Retrieval and judgment stay separate</h3><p>Use deterministic checks for metadata, identifiers and arithmetic. Use semantic models for entailment and context, with calibrated abstention and independently evaluated outcomes. Queue long reviews, cache permitted source retrieval and checkpoint jobs.</p><p>Multi-user storage, permissions, deletion, retention and institutional file access become required product capabilities. The cost includes retrieval, extraction, failed jobs and support, not just model input tokens.</p></article></div>
</section>

<section class="section" id="business"><h2>Customers, distribution and pricing</h2><div class="table-wrap"><table><thead><tr><th>Buyer</th><th>Reason to use Proof</th><th>Adoption route</th><th>Main obstacle</th></tr></thead><tbody>
<tr><th>Student</th><td>Catch unsupported claims and fix citations before a deadline.</td><td>Useful free check; per-report purchase or semester access.</td><td>Seasonal use, limited budgets and existing AI subscriptions.</td></tr>
<tr><th>Teacher / writing center</th><td>Give evidence-focused feedback and inspect source interpretation.</td><td>Small supervised course or tutoring pilot.</td><td>Added workload, curriculum fit, student privacy and procurement.</td></tr>
<tr><th>Graduate researcher / lab</th><td>Review longer drafts, reuse evidence and collaborate on corrections.</td><td>Zotero/editor integration; a funded small-team pilot.</td><td>Paywalled literature, specialist content and mature existing workflows.</td></tr>
<tr><th>Editor / publisher</th><td>Find citation misuse and produce inspectable precheck findings.</td><td>Limited manuscript pilot with reviewer adjudication.</td><td>Confidentiality, permissions, error cost and submission-system integration.</td></tr>
</tbody></table></div>
<h3>Price experiments, not a fixed business model</h3><p>The competitor snapshot includes free reference tools, low-cost student plans and more expensive research-team workflows. Price the recurring review value. Test one-off and semester offers before assuming every student needs a monthly subscription.</p>
<div class="grid"><article class="card"><span class="status quality">Proposed experiment</span><h3>Student access</h3><p>Free small checks with complete explanations and coverage disclosure. Test $3–6 per full report against $8–12/month with explicit document/page limits and an affordable semester option.</p><p>Keep export and original-source inspection available. Never hide uncertainty behind a paywall or sell an “accuracy upgrade” that implies free results are safe.</p></article><article class="card"><span class="status quality">Proposed experiment</span><h3>Team and institution access</h3><p>Test researcher access around $20–30/seat/month with defined review allowances. For a course pilot, test $8–20 per active student per semester with a minimum contract that covers onboarding and support.</p><p>These are willingness-to-pay hypotheses. They are not validated prices, market averages or margin estimates.</p></article></div>
<p style="margin-top:24px">Measure cost per completed review, including retrieval, licensed content where needed, extraction/OCR, inference, storage, retries, payment processing and human support. Set limits from observed costs and use. Broad “unlimited research” plans can fail when a small number of long reviews consume most of the budget.</p>
<h3>A credible first distribution plan</h3><ol><li>Run a few supervised pilots where someone qualified can adjudicate findings and compare the review time with their normal process.</li><li>Publish demonstrations using public or synthetic documents that show a correct claim, a real but misused citation, and an honest incomplete result.</li><li>Support Zotero and the editor pilots already use. The first integration should remove observed friction.</li><li>Earn repeated teacher, writing-center or lab use before pursuing broad institutional procurement.</li></ol>
</section>

<section class="section" id="validation"><h2>What to test before expanding</h2><p>Researching product pages cannot establish that Proof is more accurate or useful. Run the same tasks through Proof, direct competitors and a strong manual/assistant baseline. Define the comparison before collecting results.</p>
<div class="grid"><article class="card"><h3>A document-level benchmark</h3><p>Start with 200–300 claim/source pairs across several subjects, embedded in realistic documents. Include faithful claims, exaggerated causation, wrong populations, numerical/unit errors, quotation drift, real-but-irrelevant citations, missing citations, fabricated references, publication notices and inaccessible sources.</p><p>Have at least two qualified reviewers label support and adjudicate disagreements. Keep development examples and an unseen evaluation set separate. Include citations and source formats that the parser finds difficult.</p></article><article class="card"><h3>Compare the workflow and its errors</h3><p>Include Scite, Grammarly Citation Finder, Jenni review, Paperpal reference checks and the strongest general-assistant audit workflow. Add Elicit/Paperguide if testing research synthesis. Use paid access only when authorized and record product versions and settings.</p><p>Evaluate products on their stated scope. A reference checker should not receive a fabricated semantic-accuracy score for a feature it does not claim. Compare the user’s completed job as well as individual checks.</p></article></div>
<div class="table-wrap"><table><thead><tr><th>Measure</th><th>Why it matters</th></tr></thead><tbody>
<tr><th>False clearance</th><td>How often unsupported or contradicted claims receive a positive result. Report both the fraction of bad claims cleared and the error rate among all positive results.</td></tr>
<tr><th>Coverage and abstention</th><td>Claims detected, sources identified, full text obtained, readable sections covered and decisions withheld. Keep retrieval failure separate from semantic uncertainty.</td></tr>
<tr><th>Evidence faithfulness</th><td>Whether quotations appear in the cited original, locators are correct, and omitted context changes the interpretation.</td></tr>
<tr><th>Actionable findings</th><td>Fraction of flags reviewers agree need correction, plus significant errors missed. False alarms can erase the time saved.</td></tr>
<tr><th>Review time</th><td>Time for a writer and reviewer to inspect, resolve and export the findings, including import and retry overhead.</td></tr>
<tr><th>Repeat adoption</th><td>Second-document review, evidence reuse, paid conversion and sustained teacher/team use. Track assignment-driven cohorts rather than treating every inactive student as churn.</td></tr>
<tr><th>Completed-review cost</th><td>Cost and latency at median and high-percentile document sizes, including failures, support and content access.</td></tr>
</tbody></table></div>
<p>Report confidence intervals and field-level results, not a single “accuracy” percentage. Support detection, passage retrieval and bibliography matching have different denominators. The RefVerifier authors’ small manuscript study is not directly comparable to any existing Proof test.</p>
<p class="sources"><a href="https://arxiv.org/abs/2609.07652">RefVerifier evaluation context</a></p>
<div class="thesis"><p><strong>The next product I would build</strong> is a persistent Proof project with a dependable evidence review, a saved source library and one editor connection. That is enough to test whether people return and pay. The complete suite should grow from that result.</p></div>
</section>

<section class="section" id="method"><h2>Research notes</h2><p>Researched on 30 September 2026 using official product sites, vendor help documentation and primary research repositories/papers. Feature descriptions are vendor-documented capabilities, not independent performance validation. No competitor accounts were purchased, no private manuscripts were uploaded and no hands-on comparative benchmark was run.</p>
<p>Pricing is quoted only when the accessible source exposed an amount. Annual equivalents, temporary promotions, regional offers and ambiguous page states are marked. Missing prices are not estimates. Search snippets with older conflicting prices were excluded when a newer official page could be opened.</p>
<p>Google’s official announcement identifies NotebookLM’s rename to Gemini Notebook on 16 July 2026. Papers AI is distinct from the former Papers by ReadCube. RefVerifier and RefChecker are included as technical overlap, not as established commercial competitors.</p>
<p class="sources"><a href="https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/">Google rename announcement</a> · <a href="https://dspace.writefull.com/">Papers AI naming context</a> · <a href="https://arxiv.org/abs/2609.07652">RefVerifier</a> · <a href="https://github.com/amazon-science/RefChecker">RefChecker</a></p>
<p>This public edition contains public competitor research and a proposed product direction. It excludes customer records, private school materials, confidential documents, credentials and deployment details. The proposed roadmap, target users, pricing experiments and threat assessments are recommendations, not settled product commitments.</p>
<p>Coverage includes academic writing, evidence checking, research discovery, reference libraries, institutional review, general assistants and systematic-review tools. Specialist platforms and small emerging tools outside this selected set may still matter in a narrower market. Refresh this map before committing to a build or purchasing software.</p>
</section>
<footer>Proof · Suite direction and competition · 30 September 2026<br>Public research edition. All competitor facts link to official sources in the profiles. Proposed capabilities remain proposals.</footer>
</main></div></body></html>'''

html = html.replace('FONT_CSS', font_css()).replace('COMPETITOR_ROWS', rows).replace('COMPETITOR_DIRECTORY', directory)
html = html.translate(str.maketrans({'“': '"', '”': '"', '’': "'", '‘': "'"})).replace('–', ' to ')
OUT.mkdir(parents=True, exist_ok=True)
target = OUT / 'proof-suite-and-competition.html'
target.write_text(html, encoding='utf-8')
print(f'{target}\n{len(competitors)} profiles · {len(html.encode()):,} bytes')
