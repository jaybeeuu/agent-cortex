---
"@jaybeeuu/agent-cortex": patch
---

Add integration and e2e layer conventions to `style-tests`. A new `## Integration and e2e`
section in `EXAMPLES.md` covers six sub-topics with `❌ Instead` / `✅ Write` pairs: what each
layer proves, real collaborators over fakes, isolation at the integration layer, bounded async
deadlines over sleeps, determinism at the edges, and what e2e should prove. `SKILL.md`
generalises the AWS-specific "Integration and e2e are realistic" principle to real-service
guidance, defines what unit, integration, and e2e each prove in workflow step 1, and adds two
Red Flags rows — an "integration" test that mocks the collaborator it exists to integrate with,
and e2e re-testing business rules already covered by unit tests — plus two matching checklist
items.
