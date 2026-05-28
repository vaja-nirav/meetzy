import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { User } from '../users/entities/user.entity';

@ApiTags('Chat')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('history/:userId')
  @ApiOperation({ summary: 'Get paginated message history with a user' })
  getHistory(
    @CurrentUser() user: User,
    @Param('userId') partnerId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.chatService.getHistory(user.id, Number(partnerId), query.limit, query.offset);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List all conversations for current user' })
  getConversations(@CurrentUser() user: User) {
    return this.chatService.getConversations(user.id);
  }
}
