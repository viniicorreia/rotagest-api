import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }

  /** Executa uma verificação descartável para igualar o tempo de resposta quando o usuário não existe. */
  async burn(password: string): Promise<void> {
    this.dummyHash ??= this.hash('rotagest-dummy-password-0');
    await this.verify(await this.dummyHash, password);
  }
}
