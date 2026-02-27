export interface OpenAIModel {
	readonly id: string;
	readonly object: "model";
	readonly created: number;
	readonly owned_by: string;
}

export interface OpenAIModelListResponse {
	readonly object: "list";
	readonly data: OpenAIModel[];
}

export function buildModelsResponse(modelId: string, owner: string): OpenAIModelListResponse {
	return {
		object: "list",
		data: [
			{
				id: modelId,
				object: "model",
				created: Math.floor(Date.now() / 1000),
				owned_by: owner,
			},
		],
	};
}
