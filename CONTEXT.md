# Proof evidence review

Proof distinguishes statements that need evidence from the surrounding document text.

## Language

**Claim**:
A factual assertion or evidence-based interpretation that evidence could support or challenge. A name, document header, title, question, instruction, or pure preference is not a claim by itself.
_Avoid_: Sentence, search query

**Claim candidate**:
A passage that may contain a claim, including cases where its role is uncertain. A candidate has not yet been confirmed as a claim.
_Avoid_: Verified claim

**Claim preview**:
The review of proposed claim candidates before research begins. Uncertain candidates are selected by default, and the writer can change the selection.
_Avoid_: Research result

**Evidence-based interpretation**:
A reading or inference whose reasoning can be supported or challenged by passages in the relevant work or other evidence.
_Avoid_: Pure preference

**Evidence route**:
The appropriate material for a claim: academic research for scientific assertions, supported authoritative domains for public facts, and supplied original text or personal evidence for literary and private claims. The preview and backend use the same paragraph context.
_Avoid_: Search every sentence

**Supplied evidence first**:
Research modes assess selected material before making external searches. A complete, unambiguous support result can avoid a search. Uncertain judgments, contradictory evidence, incomplete extraction, abstract-only access and publication warnings do not satisfy this rule. Agreement with supplied text does not establish independently verified provenance.

**Shared research**:
Related claims can share a query and retrieved material. Each retains its own original span and separate evidence judgment. Negations, numbers and scope stay in the search query.
_Avoid_: Shared verdict

**Evidence gap**:
A visible limitation such as unavailable full text, an unresolved source, unreadable pages, conflicting evidence or a spending limit. It is never positive support.

**API efficiency**:
Reuse suitable material and completed candidate resolutions within the run, avoid duplicate retrieval and honor cancellation and retry limits. Keep existing spending limits and support thresholds. Successful paid responses are not resent because their accounting update failed; the durable reservation remains auditable with unknown usage.

**Acceptance deliverable**:
Exact stored evidence and honest locators, claim coverage or explicit gaps, bibliography and citation correctness, approved safe corrections, version integrity and a result that survives reopening. Test local UI, workers and real providers separately from hosted authentication and deployment.

Academic checks inspect every extracted section permitted by the source selection, rather than only the highest-ranked retrieval results. A later contradiction, uncertain section, incomplete extraction or interrupted judgment prevents complete support. Uncertain or incomplete academic checks withhold automatic corrections. This quality rule also applies when scientific claims are checked against supplied text before external research.
