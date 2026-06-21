export interface PaymentService {
  release(taskId: string, nodeId: string): Promise<string>;
}

