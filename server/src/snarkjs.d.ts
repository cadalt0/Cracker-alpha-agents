declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, string>,
      wasmFile: string,
      zkeyFileName: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(vkey: object, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
