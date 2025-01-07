'use client'

import React, { useContext, useState } from 'react';
import { MessageCircle, Users, File, Search, Settings, LogOut } from 'lucide-react';
import { AuthContext } from '@/app/AuthContext';

// Main Chat Component
const ChatGenius = () => {
    const { user, logout } = useContext(AuthContext);
    const [channels, setChannels] = useState([]);
    const [directMessages, setDirectMessages] = useState([]);
    const [currentChannel, setCurrentChannel] = useState(null);
    const [messages, setMessages] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);

    // Mock data
    const mockChannels = [
        { id: 1, name: 'general', unread: 2 },
        { id: 2, name: 'random', unread: 0 },
        { id: 3, name: 'team-updates', unread: 5 }
    ];

    const mockUsers = [
        { id: 1, name: 'Alice Smith', status: 'online', avatar: '/api/placeholder/32/32' },
        { id: 2, name: 'Bob Johnson', status: 'away', avatar: '/api/placeholder/32/32' },
        { id: 3, name: 'Carol White', status: 'offline', avatar: '/api/placeholder/32/32' }
    ];

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-800 text-white flex flex-col">
                {/* App Header */}
                <div className="p-4 border-b border-gray-700">
                    <h1 className="text-xl font-bold">ChatGenius</h1>
                </div>

                {/* Channels */}
                <div className="p-4">
                    <h2 className="mb-2 text-gray-400 uppercase text-sm">Channels</h2>
                    {mockChannels.map(channel => (
                        <div key={channel.id}
                            className="flex items-center mb-2 cursor-pointer hover:bg-gray-700 p-2 rounded">
                            <MessageCircle className="w-4 h-4 mr-2" />
                            <span>{channel.name}</span>
                            {channel.unread > 0 && (
                                <span className="ml-auto bg-blue-500 rounded-full px-2 py-1 text-xs">
                                    {channel.unread}
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {/* Direct Messages */}
                <div className="p-4">
                    <h2 className="mb-2 text-gray-400 uppercase text-sm">Direct Messages</h2>
                    {mockUsers.map(user => (
                        <div key={user.id}
                            className="flex items-center mb-2 cursor-pointer hover:bg-gray-700 p-2 rounded">
                            <div className="relative">
                                <img src={user.avatar}
                                    alt={user.name}
                                    className="w-6 h-6 rounded-full mr-2" />
                                <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ${user.status === 'online' ? 'bg-green-500' :
                                        user.status === 'away' ? 'bg-yellow-500' : 'bg-gray-500'
                                    }`} />
                            </div>
                            <span>{user.name}</span>
                        </div>
                    ))}
                </div>

                {/* User Profile */}
                <div className="mt-auto p-4 border-t border-gray-700 flex items-center">
                    <img src={user?.avatar || "/api/placeholder/40/40"}
                        alt={user?.name || "Current user"}
                        className="w-10 h-10 rounded-full mr-3" />
                    <div className="flex-1">
                        <div className="font-medium">{user?.name || "Current User"}</div>
                        <div className="text-sm text-gray-400">Active</div>
                    </div>
                    <Settings className="w-5 h-5 cursor-pointer hover:text-gray-400 mr-2" />
                    <LogOut className="w-5 h-5 cursor-pointer hover:text-gray-400" onClick={logout} />
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                {/* Channel Header */}
                <div className="bg-white border-b p-4 flex items-center justify-between">
                    <div className="flex items-center">
                        <h2 className="text-xl font-semibold"># general</h2>
                        <span className="ml-2 text-gray-500">3 members</span>
                    </div>
                    <div className="flex items-center space-x-4">
                        <Search className="w-5 h-5 text-gray-500 cursor-pointer" />
                        <Users className="w-5 h-5 text-gray-500 cursor-pointer" />
                        <File className="w-5 h-5 text-gray-500 cursor-pointer" />
                    </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Sample Message */}
                    <div className="flex items-start">
                        <img src="/api/placeholder/40/40"
                            alt="User avatar"
                            className="w-10 h-10 rounded-full mr-3" />
                        <div>
                            <div className="flex items-baseline">
                                <span className="font-medium mr-2">Alice Smith</span>
                                <span className="text-sm text-gray-500">12:34 PM</span>
                            </div>
                            <p className="text-gray-800">
                                Hey team! Just wanted to share an update on the project.
                            </p>
                            {/* Reactions */}
                            <div className="flex mt-2 space-x-2">
                                <span className="bg-gray-100 rounded-full px-2 py-1 text-sm cursor-pointer hover:bg-gray-200">
                                    👍 2
                                </span>
                                <span className="bg-gray-100 rounded-full px-2 py-1 text-sm cursor-pointer hover:bg-gray-200">
                                    ❤️ 1
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Message Input */}
                <div className="p-4 border-t">
                    <div className="flex items-center bg-gray-100 rounded-lg p-2">
                        <input
                            type="text"
                            placeholder="Message #general"
                            className="flex-1 bg-transparent outline-none"
                        />
                        <div className="flex items-center space-x-2">
                            <File className="w-5 h-5 text-gray-500 cursor-pointer" />
                            <button className="bg-blue-500 text-white px-4 py-1 rounded-md hover:bg-blue-600">
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatGenius;