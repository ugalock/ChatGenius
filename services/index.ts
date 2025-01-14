import { AIAvatarService } from './AIAvatar';

const avatarService = new AIAvatarService();
await avatarService.initialize();

export { avatarService };