import { MapPin, Link as LinkIcon, Calendar, Users, Star, GitFork, Book, Mail, Upload, Loader2, Camera } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { authStore } from "@luxio/common";

interface Repository {
  id: number;
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  isPrivate: boolean;
  updatedAt: string;
}

interface UserProfile {
  name: string;
  username: string;
  avatar: string;
  bio: string;
  location: string;
  website: string;
  email: string;
  joinDate: string;
  followers: number;
  following: number;
  repositories: number;
  stars: number;
}

export function Profile() {
  const [pinnedRepos, setPinnedRepos] = useState<Repository[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "repositories" | "stars">("overview");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState(authStore.getState());
  const { user, isAuthenticated, loading } = state;

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setUploadError("Invalid file type. Only images are allowed.");
      return;
    }

    // 验证文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File size exceeds 5MB limit");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const userId = '9d3b2884-c89a-4be8-a416-b45ae85579f5';
      const bucketName = 'make-1334fc59-avatars';

      // 生成唯一文件名
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `public/${userId}/${fileName}`;

      // 读取文件内容
      const fileBuffer = await file.arrayBuffer();

      // 调用Supabase Storage REST API - POST upload/resumable (TUS protocol)
      const uploadUrl = `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
          'apikey': publicAnonKey,
          'x-upsert': 'true',
          // "priority": "u=1, i",
          'Content-Type': 'application/offset+octet-stream',
          "tus-resumable": "1.0.0",
          'Upload-Length': file.size.toString(),
          'Upload-Metadata': `bucketName ${btoa(bucketName)},objectName ${btoa(filePath)},contentType ${btoa(file.type)},cacheControl ${btoa('max-age=3600')}`
        },
        body: fileBuffer
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("Storage API error:", errorText);
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      // 生成公开URL
      const publicUrl = `https://${projectId}.supabase.co/storage/v1/object/public/${bucketName}/${filePath}`;

      // 更新profile中的avatar URL
      if (user) {
        setUser({
          ...user,
          avatar: publicUrl
        });
      }

      // 可选：调用后端API更新数据库中的avatar字段
      try {
        await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-1334fc59/user/avatar/${userId}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${publicAnonKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ avatarUrl: publicUrl })
          }
        );
      } catch (dbError) {
        console.warn('Failed to update avatar in database:', dbError);
      }

      console.log('Avatar uploaded successfully:', publicUrl);
    } catch (error) {
      console.error('Avatar upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      // 重置file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    const mockPinnedRepos: Repository[] = [
      {
        id: 1,
        name: "awesome-react-components",
        description: "A collection of awesome React components for modern web applications",
        language: "TypeScript",
        stars: 2345,
        forks: 456,
        isPrivate: false,
        updatedAt: "2026-04-20"
      },
      {
        id: 2,
        name: "web-performance-toolkit",
        description: "Tools and utilities for optimizing web application performance",
        language: "JavaScript",
        stars: 1678,
        forks: 234,
        isPrivate: false,
        updatedAt: "2026-04-18"
      },
      {
        id: 3,
        name: "design-system",
        description: "Comprehensive design system with components, tokens, and guidelines",
        language: "TypeScript",
        stars: 987,
        forks: 123,
        isPrivate: false,
        updatedAt: "2026-04-15"
      },
      {
        id: 4,
        name: "api-gateway",
        description: "Scalable API gateway with authentication and rate limiting",
        language: "Go",
        stars: 654,
        forks: 89,
        isPrivate: true,
        updatedAt: "2026-04-10"
      }
    ];

    setPinnedRepos(mockPinnedRepos);
  }, []);

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  const getLanguageColor = (language: string) => {
    const colors: Record<string, string> = {
      TypeScript: "bg-blue-500",
      JavaScript: "bg-yellow-500",
      Go: "bg-cyan-500",
      Python: "bg-green-500",
      Java: "bg-orange-500",
      Ruby: "bg-red-500"
    };
    return colors[language] || "bg-gray-500";
  };

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Profile Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-6">
          <div className="flex gap-8">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <div className="relative group">
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-32 h-32 rounded-full border-4 border-gray-100 object-cover"
                />
                {/* Upload overlay */}
                <button
                  onClick={handleAvatarClick}
                  disabled={uploading}
                  className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-50 rounded-full transition-all duration-200 cursor-pointer"
                  title="Upload new avatar"
                >
                  {uploading ? (
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  ) : (
                    <Camera className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </div>
              {uploadError && (
                <p className="mt-2 text-xs text-red-600">{uploadError}</p>
              )}
            </div>

            {/* Profile Info */}
            <div className="flex-1">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-1">{user.name}</h1>
                  <p className="text-gray-600">@{user.username}</p>
                </div>
                <button className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">
                  Edit Profile
                </button>
              </div>

              <p className="text-gray-700 mb-4">{user.bio}</p>

              {/* Profile Metadata */}
              <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-4">
                {user.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    <span>{user.location}</span>
                  </div>
                )}
                {user.email && (
                  <div className="flex items-center gap-1">
                    <Mail className="w-4 h-4" />
                    <span>{user.email}</span>
                  </div>
                )}
                {user.website && (
                  <div className="flex items-center gap-1">
                    <LinkIcon className="w-4 h-4" />
                    <a href={user.website} className="text-blue-600 hover:underline">
                      {user.website.replace('https://', '')}
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  <span>Joined {new Date(user.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="flex gap-6 text-sm">
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold">{user.followers.toLocaleString()}</span>
                  <span className="text-gray-600">followers</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-semibold">{user.following.toLocaleString()}</span>
                  <span className="text-gray-600">following</span>
                </div>
                <div className="flex items-center gap-1">
                  <Book className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold">{user.repositories}</span>
                  <span className="text-gray-600">repositories</span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold">{user.stars}</span>
                  <span className="text-gray-600">stars</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab("overview")}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${activeTab === "overview"
                  ? "text-red-600 border-b-2 border-red-600"
                  : "text-gray-600 hover:text-gray-900"
                }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab("repositories")}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${activeTab === "repositories"
                  ? "text-red-600 border-b-2 border-red-600"
                  : "text-gray-600 hover:text-gray-900"
                }`}
            >
              Repositories
            </button>
            <button
              onClick={() => setActiveTab("stars")}
              className={`pb-3 px-1 text-sm font-medium transition-colors ${activeTab === "stars"
                  ? "text-red-600 border-b-2 border-red-600"
                  : "text-gray-600 hover:text-gray-900"
                }`}
            >
              Stars
            </button>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === "overview" && (
          <div>
            {/* Pinned Repositories */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Pinned Repositories</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pinnedRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Book className="w-4 h-4 text-gray-500" />
                        <h3 className="font-semibold text-blue-600 hover:underline cursor-pointer">
                          {repo.name}
                        </h3>
                      </div>
                      {repo.isPrivate && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full border border-gray-300">
                          Private
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{repo.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-600">
                      <div className="flex items-center gap-1">
                        <div className={`w-3 h-3 rounded-full ${getLanguageColor(repo.language)}`} />
                        <span>{repo.language}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        <span>{repo.stars.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <GitFork className="w-3 h-3" />
                        <span>{repo.forks.toLocaleString()}</span>
                      </div>
                      <span>Updated {new Date(repo.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Contribution Graph */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Contribution Activity</h2>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-gray-600">Less</span>
                <div className="flex gap-1">
                  <div className="w-3 h-3 bg-gray-100 rounded-sm" />
                  <div className="w-3 h-3 bg-green-200 rounded-sm" />
                  <div className="w-3 h-3 bg-green-400 rounded-sm" />
                  <div className="w-3 h-3 bg-green-600 rounded-sm" />
                  <div className="w-3 h-3 bg-green-800 rounded-sm" />
                </div>
                <span className="text-sm text-gray-600">More</span>
              </div>
              <div className="grid grid-cols-52 gap-1">
                {Array.from({ length: 365 }).map((_, i) => {
                  const intensity = Math.floor(Math.random() * 5);
                  const colors = ['bg-gray-100', 'bg-green-200', 'bg-green-400', 'bg-green-600', 'bg-green-800'];
                  return (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-sm ${colors[intensity]}`}
                      title={`${intensity} contributions`}
                    />
                  );
                })}
              </div>
              <p className="text-sm text-gray-600 mt-4">
                <span className="font-semibold">1,234</span> contributions in the last year
              </p>
            </div>
          </div>
        )}

        {activeTab === "repositories" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600">Repository list will be displayed here</p>
          </div>
        )}

        {activeTab === "stars" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600">Starred repositories will be displayed here</p>
          </div>
        )}
      </div>
    </div>
  );
}
