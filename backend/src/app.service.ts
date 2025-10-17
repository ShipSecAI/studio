import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'shipsec-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
