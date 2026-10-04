declare module "citeproc" {
  const CSL: {
    Engine: new (
      system: {
        retrieveLocale: (language: string) => string;
        retrieveItem: (id: string) => unknown;
      },
      style: string,
      language: string,
    ) => {
      updateItems(ids: string[]): void;
      setOutputFormat(format: "text" | "html"): void;
      makeBibliography():
        | [
            {
              entry_ids: string[][];
              hangingindent?: boolean;
              linespacing?: number;
            },
            string[],
          ]
        | false;
      makeCitationCluster(items: Record<string, unknown>[]): string;
    };
  };
  export default CSL;
}
