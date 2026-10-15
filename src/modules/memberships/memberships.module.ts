import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembershipsService } from './memberships.service';

@Module({
  controllers: [MembersController, InvitationsController],
  providers: [MembershipsService, InvitationsService],
})
export class MembershipsModule {}
