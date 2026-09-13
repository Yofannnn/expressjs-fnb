export interface ResetPasswordCommand {
  resetToken: string;
  newPassword: string;
}

export interface ResetPasswordUseCasePort {
  execute(command: ResetPasswordCommand): Promise<void>;
}
