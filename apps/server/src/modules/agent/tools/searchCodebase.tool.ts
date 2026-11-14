import {
  SearchCodebaseToolInput,
  SearchCodebaseToolInputSchema,
  SemanticSearchResultDto,
} from '@codecollab/shared';
import { CodebaseIndexService } from '../../ai/codebaseIndex.service';
import { AgentTool, AgentToolContext } from './agentTool.interface';

export class SearchCodebaseTool implements AgentTool<SearchCodebaseToolInput> {
  readonly name = 'search_codebase' as const;
  readonly description =
    'Performs semantic vector search across the project codebase to retrieve relevant code snippets, interfaces, and function references.';
  readonly schema = SearchCodebaseToolInputSchema;

  async execute(
    context: AgentToolContext,
    input: SearchCodebaseToolInput
  ): Promise<{
    query: string;
    results: SemanticSearchResultDto[];
    count: number;
  }> {
    const { branchId, projectId, userId } = context;

    const searchResponse = await CodebaseIndexService.semanticSearch(
      projectId,
      branchId,
      userId,
      {
        query: input.query,
        topK: input.topK ?? 5,
        minScore: 0.2,
      }
    );

    return {
      query: input.query,
      results: searchResponse.results,
      count: searchResponse.results.length,
    };
  }
}
