/**
 * API Documentation page using Swagger UI
 * Styled to match Tracearr's dark theme with cyan accent
 * Auto-loads the user's API key for authentication
 */

import { Link } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import './ApiDocs.css';
import { useApiKey } from '@/hooks/queries/useSettings';

// Get the API base URL for fetching the OpenAPI spec
const API_BASE = import.meta.env.VITE_API_URL || '';

export function ApiDocs() {
  const { data: apiKeyData, isLoading } = useApiKey();
  const token = apiKeyData?.token;

  // Show loading while fetching API key
  if (isLoading) {
    return (
      <div className="swagger-wrapper flex items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="swagger-wrapper">
      <div className="swagger-header">
        <Link to="/settings">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
        {token && <span className="text-muted-foreground ml-4 text-sm">API key auto-loaded</span>}
        {!token && (
          <span className="ml-4 text-sm text-yellow-500">
            No API key generated - create one in Settings to test endpoints
          </span>
        )}
      </div>
      <SwaggerUI
        url={`${API_BASE}/api/v1/public/docs`}
        requestInterceptor={(req) => {
          if (token) {
            req.headers['Authorization'] = `Bearer ${token}`;
          }
          return req;
        }}
        onComplete={(system) => {
          if (token && system.authActions) {
            system.authActions.authorize({
              bearerAuth: {
                name: 'bearerAuth',
                schema: { type: 'http', scheme: 'bearer' },
                value: token,
              },
            });
          }
        }}
      />
    </div>
  );
}
