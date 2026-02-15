import { IsArray, IsNotEmpty } from 'class-validator';
import type { UIMessage } from 'ai';

export class ChatRequestDto {
  @IsArray()
  @IsNotEmpty()
  messages!: UIMessage[];
}
