declare module "kuroshiro" {
  export default class Kuroshiro {
    static Util: {
      kanaToRomaji(
        text: string,
        system: "nippon" | "passport" | "hepburn",
      ): string;
    };
    init(analyzer: { init(): Promise<void> }): Promise<void>;
    convert(
      text: string,
      options: { to: "hiragana"; mode?: "normal" },
    ): Promise<string>;
  }
}

declare module "kuroshiro-analyzer-kuromoji" {
  export default class KuromojiAnalyzer {
    constructor(options?: { dictPath?: string });
    init(): Promise<void>;
  }
}
