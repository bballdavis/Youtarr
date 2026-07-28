import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Tooltip,
  Chip,
  Skeleton,
  Snackbar,
  Divider,
  Checkbox,
  FormControlLabel,
  Select,
  MenuItem,
} from '../../ui';
import {
  Trash2 as DeleteIcon,
  Plus as AddIcon,
  Copy as ContentCopyIcon,
  AlertTriangle as WarningIcon,
  Pencil as EditIcon,
} from 'lucide-react';
import { ConfigurationAccordion } from '../common/ConfigurationAccordion';
import { InfoTooltip } from '../common/InfoTooltip';

import { locationUtils } from '../../../utils/location';
import {
  EXTERNAL_RATING_BANDS,
  formatExternalRatingBand,
} from '../../../utils/externalRatingPolicy';
import useMediaQuery from '../../../hooks/useMediaQuery';

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
  usage_count: number;
  role: ApiKeyRole;
  auto_approve_video_requests: boolean;
  auto_approve_channel_requests: boolean;
  auto_approve_delete_requests: boolean;
  max_rating_level: number;
  allow_unrated: boolean;
  allowed_media_types: MediaType[];
  revoked_at: string | null;
}

type ApiKeyRole = 'legacy_download' | 'view' | 'request' | 'delete' | 'admin';
type MediaType = 'video' | 'short' | 'livestream';
const ROLE_PRIVILEGE: Record<ApiKeyRole, number> = {
  legacy_download: 0,
  view: 1,
  request: 2,
  delete: 3,
  admin: 4,
};

const formatApiRole = (role: ApiKeyRole) => role
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

interface ApiKeyPolicy {
  role: ApiKeyRole;
  autoApproveVideoRequests: boolean;
  autoApproveChannelRequests: boolean;
  autoApproveDeleteRequests: boolean;
  maxRatingLevel: number;
  allowUnrated: boolean;
  allowedMediaTypes: MediaType[];
}

interface ChannelOption {
  database_id?: number;
  channel_id?: string;
  uploader: string;
  title?: string;
  terminated_at?: string | null;
}

const defaultPolicy: ApiKeyPolicy = {
  role: 'legacy_download',
  autoApproveVideoRequests: false,
  autoApproveChannelRequests: false,
  autoApproveDeleteRequests: false,
  maxRatingLevel: 3,
  allowUnrated: false,
  allowedMediaTypes: ['video'],
};

const policyFromKey = (key: ApiKey): ApiKeyPolicy => ({
  role: key.role,
  autoApproveVideoRequests: key.auto_approve_video_requests,
  autoApproveChannelRequests: key.auto_approve_channel_requests,
  autoApproveDeleteRequests: key.auto_approve_delete_requests,
  maxRatingLevel: key.max_rating_level,
  allowUnrated: key.allow_unrated,
  allowedMediaTypes: key.allowed_media_types,
});

const PolicyEditor: React.FC<{
  policy: ApiKeyPolicy;
  onChange: (policy: ApiKeyPolicy) => void;
  includeLegacy?: boolean;
}> = ({ policy, onChange, includeLegacy = false }) => {
  const external = policy.role !== 'legacy_download';
  const requestCapable = ['request', 'delete', 'admin'].includes(policy.role);
  const deleteCapable = ['delete', 'admin'].includes(policy.role);
  const toggleMedia = (mediaType: MediaType) => {
    const selected = policy.allowedMediaTypes.includes(mediaType);
    if (selected && policy.allowedMediaTypes.length === 1) return;
    onChange({
      ...policy,
      allowedMediaTypes: selected
        ? policy.allowedMediaTypes.filter((value) => value !== mediaType)
        : [...policy.allowedMediaTypes, mediaType],
    });
  };
  return (
    <Box className="mt-4 space-y-3">
      <Select
        fullWidth
        value={policy.role}
        onChange={(event) => onChange({ ...policy, role: event.target.value as ApiKeyRole })}
        inputProps={{ 'aria-label': 'API key role' }}
      >
        {includeLegacy && <MenuItem value="legacy_download">Legacy download</MenuItem>}
        <MenuItem value="view">View catalog</MenuItem>
        <MenuItem value="request">View and request</MenuItem>
        <MenuItem value="delete">View, request, and request deletion</MenuItem>
        <MenuItem value="admin">External policy administrator</MenuItem>
      </Select>
      {external && (
        <>
          <Box className="space-y-1">
            <Typography variant="caption" color="secondary">
              Maximum allowed rating
            </Typography>
            <Select
              fullWidth
              aria-label="Maximum allowed rating"
              inputProps={{ 'aria-label': 'Maximum allowed rating' }}
              value={policy.maxRatingLevel}
              onChange={(event) => onChange({
                ...policy,
                maxRatingLevel: Number(event.target.value),
              })}
            >
              {EXTERNAL_RATING_BANDS.map((band) => (
                <MenuItem key={band.level} value={band.level}>
                  {formatExternalRatingBand(band.level)}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="secondary">
              Applies to a video&apos;s rating and, when no video rating exists, the channel&apos;s
              manually assigned default rating.
            </Typography>
          </Box>
          <FormControlLabel
            control={<Checkbox checked={policy.allowUnrated} onChange={(event) =>
              onChange({ ...policy, allowUnrated: event.target.checked })
            } />}
            label="Allow unrated or unrecognized ratings"
          />
          <Box className="flex flex-wrap gap-3">
            {(['video', 'short', 'livestream'] as MediaType[]).map((mediaType) => (
              <FormControlLabel
                key={mediaType}
                control={<Checkbox
                  checked={policy.allowedMediaTypes.includes(mediaType)}
                  onChange={() => toggleMedia(mediaType)}
                />}
                label={mediaType}
              />
            ))}
          </Box>
          <FormControlLabel
            disabled={!requestCapable}
            control={<Checkbox checked={policy.autoApproveVideoRequests} onChange={(event) =>
              onChange({ ...policy, autoApproveVideoRequests: event.target.checked })
            } />}
            label="Automatically approve video requests"
          />
          <FormControlLabel
            disabled={!requestCapable}
            control={<Checkbox checked={policy.autoApproveChannelRequests} onChange={(event) =>
              onChange({ ...policy, autoApproveChannelRequests: event.target.checked })
            } />}
            label="Automatically approve channel requests"
          />
          <FormControlLabel
            disabled={!deleteCapable}
            control={<Checkbox checked={policy.autoApproveDeleteRequests} onChange={(event) =>
              onChange({ ...policy, autoApproveDeleteRequests: event.target.checked })
            } />}
            label="Automatically approve deletion requests"
          />
        </>
      )}
    </Box>
  );
};

interface ApiKeyCreatedResponse {
  success: boolean;
  message: string;
  id: number;
  name: string;
  key: string;
  prefix: string;
}

interface ApiKeysSectionProps {
  token: string | null;
  apiKeyRateLimit: number;
  onRateLimitChange: (value: number) => void;
}

const ApiKeysSection: React.FC<ApiKeysSectionProps> = ({ token, apiKeyRateLimit, onRateLimitChange }) => {
  const useApiKeyCards = useMediaQuery('(max-width: 1279px)');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKeyDialogOpen, setCreatedKeyDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyPolicy, setNewKeyPolicy] = useState<ApiKeyPolicy>(defaultPolicy);
  const [newKeyChannelIds, setNewKeyChannelIds] = useState<number[]>([]);
  const [newKeyChannelSearch, setNewKeyChannelSearch] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreatedResponse | null>(null);
  const [createdKeyRole, setCreatedKeyRole] = useState<ApiKeyRole>('legacy_download');
  const [error, setError] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [editPolicy, setEditPolicy] = useState<ApiKeyPolicy>(defaultPolicy);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [channelSearch, setChannelSearch] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([]);
  const [originalChannelIds, setOriginalChannelIds] = useState<number[]>([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ open: boolean; keyId: number | null; keyName: string }>({
    open: false,
    keyId: null,
    keyName: '',
  });
  const [isHttpWarning] = useState(
    locationUtils.getProtocol() !== 'https:' && locationUtils.getHostname() !== 'localhost'
  );

  const setAvailableChannels = (channels: ChannelOption[]) => {
    setChannelOptions(
      channels.filter((channel) =>
        channel.database_id && !channel.terminated_at
      )
    );
  };

  const fetchApiKeys = useCallback(async () => {
    if (!token) return;
    
    try {
      const response = await fetch('/api/keys', {
        headers: { 'x-access-token': token },
      });
      
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.keys || []);
      } else {
        const errData = await response.json();
        setError(errData.error || 'Failed to fetch API keys');
      }
    } catch (err) {
      setError('Failed to fetch API keys');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const fetchAvailableChannels = async (): Promise<ChannelOption[]> => {
    if (!token) return [];

    const channels: ChannelOption[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await fetch(`/getchannels?page=${page}&pageSize=100&sortOrder=asc`, {
        headers: { 'x-access-token': token },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to load channels');
      channels.push(...(body.channels || []));
      if (page === 1) {
        const reportedTotalPages = Number(body.totalPages);
        totalPages = Number.isInteger(reportedTotalPages) && reportedTotalPages > 0
          ? reportedTotalPages
          : 1;
      }
      page += 1;
    } while (page <= totalPages);

    return channels;
  };

  const loadAvailableChannels = async () => {
    try {
      setAvailableChannels(await fetchAvailableChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    }
  };

  const openCreateDialog = () => {
    setCreateDialogOpen(true);
    setNewKeyChannelIds([]);
    setNewKeyChannelSearch('');
    setChannelOptions([]);
  };

  const changeNewKeyPolicy = (policy: ApiKeyPolicy) => {
    const becomingExternal =
      newKeyPolicy.role === 'legacy_download' && policy.role !== 'legacy_download';
    setNewKeyPolicy(policy);
    if (becomingExternal) void loadAvailableChannels();
  };

  const handleCreateKey = async () => {
    if (!token || !newKeyName.trim()) return;

    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': token,
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          ...(newKeyPolicy.role === 'legacy_download'
            ? {}
            : { policy: newKeyPolicy, channelIds: newKeyChannelIds }),
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setCreatedKey(data);
        setCreatedKeyRole(newKeyPolicy.role);
        setCreateDialogOpen(false);
        setCreatedKeyDialogOpen(true);
        setNewKeyName('');
        setNewKeyPolicy(defaultPolicy);
        setNewKeyChannelIds([]);
        setNewKeyChannelSearch('');
        fetchApiKeys();
      } else {
        setError(data.error || 'Failed to create API key');
      }
    } catch (err) {
      setError('Failed to create API key');
    }
  };

  const openEditDialog = async (key: ApiKey) => {
    if (!token || key.role === 'legacy_download' || key.revoked_at) return;
    setEditKey(key);
    setEditPolicy(policyFromKey(key));
    setSelectedChannelIds([]);
    setOriginalChannelIds([]);
    setChannelSearch('');
    try {
      const [grantsResponse, channels] = await Promise.all([
        fetch(`/api/keys/${key.id}/channels`, {
          headers: { 'x-access-token': token },
        }),
        fetchAvailableChannels(),
      ]);
      const grants = await grantsResponse.json();
      if (!grantsResponse.ok) {
        throw new Error(grants.error || 'Failed to load external access settings');
      }
      const grantedChannelIds = grants.channelIds || [];
      setSelectedChannelIds(grantedChannelIds);
      setOriginalChannelIds(grantedChannelIds);
      setAvailableChannels(channels);
    } catch (err) {
      setEditKey(null);
      setError(err instanceof Error ? err.message : 'Failed to load external access settings');
    }
  };

  const saveExternalAccess = async () => {
    if (!token || !editKey) return;
    const increasesPrivilege =
      ROLE_PRIVILEGE[editPolicy.role] > ROLE_PRIVILEGE[editKey.role] ||
      (editPolicy.autoApproveVideoRequests && !editKey.auto_approve_video_requests) ||
      (editPolicy.autoApproveChannelRequests && !editKey.auto_approve_channel_requests) ||
      (editPolicy.autoApproveDeleteRequests && !editKey.auto_approve_delete_requests) ||
      editPolicy.maxRatingLevel > editKey.max_rating_level ||
      (editPolicy.allowUnrated && !editKey.allow_unrated) ||
      editPolicy.allowedMediaTypes.some(
        (mediaType) => !editKey.allowed_media_types.includes(mediaType)
      ) ||
      selectedChannelIds.some((channelId) => !originalChannelIds.includes(channelId));
    if (increasesPrivilege && !window.confirm(
      'This change may increase what the external integration can view or request. Continue?'
    )) return;
    setSavingPolicy(true);
    try {
      const response = await fetch(`/api/keys/${editKey.id}/external-access`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': token,
        },
        body: JSON.stringify({
          policy: editPolicy,
          channelIds: selectedChannelIds,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to save external access');
      setSnackbar({ open: true, message: 'External access updated' });
      setEditKey(null);
      await fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save external access');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!token || !deleteConfirmDialog.keyId) return;

    try {
      const response = await fetch(`/api/keys/${deleteConfirmDialog.keyId}`, {
        method: 'DELETE',
        headers: { 'x-access-token': token },
      });

      if (response.ok) {
        setSnackbar({ open: true, message: 'API key revoked' });
        fetchApiKeys();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to revoke API key');
      }
    } catch (err) {
      setError('Failed to revoke API key');
    } finally {
      setDeleteConfirmDialog({ open: false, keyId: null, keyName: '' });
    }
  };

  const openDeleteConfirmDialog = (id: number, name: string) => {
    setDeleteConfirmDialog({ open: true, keyId: id, keyName: name });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setSnackbar({ open: true, message: `${label} copied to clipboard` });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const generateBookmarklet = (apiKey: string) => {
    const serverUrl = locationUtils.getOrigin();
    const code = `javascript:(function(){var k='${apiKey}';var s='${serverUrl}';var u=location.href;if(!/youtube\\.com|youtu\\.be/.test(u)){alert('Not YouTube');return;}fetch(s+'/api/videos/download',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':k},body:JSON.stringify({url:u})}).then(function(r){return r.json()}).then(function(d){alert(d.success?'✓ Added: '+(d.video&&d.video.title?d.video.title:'Queued'):'✗ '+d.error)}).catch(function(){alert('✗ Connection failed')})})();`;
    return code;
  };

  if (loading) {
    return (
      <ConfigurationAccordion title="API Keys & External Access">
        <Skeleton variant="rectangular" height={200} />
      </ConfigurationAccordion>
    );
  }

  return (
    <ConfigurationAccordion title="API Keys & External Access">
      <Typography variant="body2" color="secondary" className="mb-4">
        Legacy keys support the bookmarklet download endpoint. Constrained external keys can browse approved
        channels and submit approval-backed requests through <code>/external-api/v1</code>.
      </Typography>

      {/* Rate Limit Setting */}
      <Box className="flex items-center mb-6">
        <TextField
          type="number"
          label="Rate Limit (requests/min)"
          value={apiKeyRateLimit}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 100) {
              onRateLimitChange(val);
            }
          }}
          inputProps={{ min: 1, max: 100 }}
          size="small"
          className="w-[200px]"
        />
        <InfoTooltip text="Maximum download requests per minute per API key. Helps prevent abuse." />
      </Box>

      <Divider className="mb-6" />

      <Box className="flex justify-between items-center mb-4">
        <Typography variant="subtitle1">Manage API Keys</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon size={16} />}
          onClick={openCreateDialog}
          size="small"
        >
          Create Key
        </Button>
      </Box>

      {isHttpWarning && (
        <Alert severity="warning" className="mb-4" icon={<WarningIcon size={20} />}>
          Creating API keys over HTTP is insecure. Use HTTPS in production.
        </Alert>
      )}

      {error && (
        <Alert severity="error" className="mb-4" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {apiKeys.length === 0 ? (
        <Paper className="p-6 text-center">
          <Typography color="secondary">
            No API keys created yet. Create one to enable external integrations.
          </Typography>
        </Paper>
      ) : (
        <>
          {!useApiKeyCards ? (
          <div>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Key</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Last Used</TableCell>
                    <TableCell align="center">Uses</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>{key.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={`${key.key_prefix}...`}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={key.revoked_at ? 'Revoked' : formatApiRole(key.role)}
                          size="small"
                          color={key.revoked_at ? 'error' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{formatDate(key.created_at)}</TableCell>
                      <TableCell>{formatDate(key.last_used_at)}</TableCell>
                      <TableCell align="center">
                        <Chip
                          label={key.usage_count}
                          size="small"
                          color={key.usage_count > 0 ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        {key.role !== 'legacy_download' && !key.revoked_at && (
                          <Tooltip title="Edit external access">
                            <IconButton
                              size="small"
                              onClick={() => openEditDialog(key)}
                              aria-label="Edit external access"
                            >
                              <EditIcon size={16} />
                            </IconButton>
                          </Tooltip>
                        )}
                        {!key.revoked_at && <Tooltip title="Revoke">
                          <IconButton
                            size="small"
                            onClick={() => openDeleteConfirmDialog(key.id, key.name)}
                            color="error"
                            aria-label="Revoke"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          ) : (
          <div className="grid gap-3" aria-label="API key cards">
            {apiKeys.map((key) => (
              <Paper key={key.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Typography variant="subtitle2" className="truncate">{key.name}</Typography>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Chip label={`${key.key_prefix}...`} size="small" variant="outlined" />
                      <Chip
                        label={key.revoked_at ? 'Revoked' : formatApiRole(key.role)}
                        size="small"
                        color={key.revoked_at ? 'error' : 'default'}
                        variant="outlined"
                      />
                      <Chip
                        label={`${key.usage_count} ${key.usage_count === 1 ? 'use' : 'uses'}`}
                        size="small"
                        color={key.usage_count > 0 ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {key.role !== 'legacy_download' && !key.revoked_at && (
                      <Tooltip title="Edit external access">
                        <IconButton
                          size="small"
                          onClick={() => openEditDialog(key)}
                          aria-label="Edit external access"
                        >
                          <EditIcon size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {!key.revoked_at && (
                      <Tooltip title="Revoke">
                        <IconButton
                          size="small"
                          onClick={() => openDeleteConfirmDialog(key.id, key.name)}
                          color="error"
                          aria-label="Revoke"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {key.role !== 'legacy_download' && (
                  <div className="rounded-[var(--radius-ui)] border border-border bg-muted/40 p-3">
                    <Typography variant="caption" color="secondary">Rating ceiling</Typography>
                    <div className="text-sm text-foreground">
                      {formatExternalRatingBand(key.max_rating_level)}
                    </div>
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Created</dt>
                    <dd className="text-foreground">{formatDate(key.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last used</dt>
                    <dd className="text-foreground">{formatDate(key.last_used_at)}</dd>
                  </div>
                </dl>
              </Paper>
            ))}
          </div>
          )}
        </>
      )}

      {/* Create Key Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Key Name"
            placeholder="e.g., iPhone Shortcut, Bookmarklet"
            fullWidth
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            inputProps={{ maxLength: 100 }}
            helperText="A descriptive name to identify this key"
          />
          <Typography variant="subtitle2" className="mt-4 mb-2">Key type and policy</Typography>
          <PolicyEditor
            policy={newKeyPolicy}
            onChange={changeNewKeyPolicy}
            includeLegacy
          />
          {newKeyPolicy.role !== 'legacy_download' && (
            <>
              <Divider className="my-5" />
              <Typography variant="subtitle2" className="mb-2">
                Approved channels ({newKeyChannelIds.length})
              </Typography>
              <Typography variant="body2" color="secondary" className="mb-3">
                The key cannot browse or request from channels that are not selected.
              </Typography>
              <TextField
                label="Search channels for new key"
                value={newKeyChannelSearch}
                onChange={(event) => setNewKeyChannelSearch(event.target.value)}
                fullWidth
                size="small"
                className="mb-3"
              />
              {channelOptions.length === 0 ? (
                <Typography variant="body2" color="secondary">
                  No enabled, non-terminated channels are available.
                </Typography>
              ) : (
                <Box className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[240px] overflow-auto">
                  {channelOptions.filter((channel) => {
                    const query = newKeyChannelSearch.trim().toLowerCase();
                    if (!query) return true;
                    return [channel.title, channel.uploader, channel.channel_id]
                      .filter(Boolean)
                      .some((value) => value?.toLowerCase().includes(query));
                  }).map((channel) => {
                    const databaseId = channel.database_id as number;
                    return (
                      <FormControlLabel
                        key={databaseId}
                        control={<Checkbox
                          checked={newKeyChannelIds.includes(databaseId)}
                          onChange={(event) => setNewKeyChannelIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, databaseId])].sort((a, b) => a - b)
                              : current.filter((id) => id !== databaseId)
                          )}
                        />}
                        label={channel.title || channel.uploader ||
                          channel.channel_id || `Channel ${databaseId}`}
                      />
                    );
                  })}
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateKey}
            variant="contained"
            disabled={!newKeyName.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(editKey)}
        onClose={() => setEditKey(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit External Access — {editKey?.name}</DialogTitle>
        <DialogContent>
          <Alert severity="info" className="mb-4">
            Role, policy, and channel grants are enforced by Youtarr on every request.
          </Alert>
          <PolicyEditor policy={editPolicy} onChange={setEditPolicy} />
          <Divider className="my-5" />
          <Typography variant="subtitle2" className="mb-2">
            Approved channels ({selectedChannelIds.length})
          </Typography>
          <TextField
            label="Search channels"
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            fullWidth
            size="small"
            className="mb-3"
          />
          {channelOptions.length === 0 ? (
            <Typography variant="body2" color="secondary">
              No enabled, non-terminated channels are available.
            </Typography>
          ) : (
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[320px] overflow-auto">
              {channelOptions.filter((channel) => {
                const query = channelSearch.trim().toLowerCase();
                if (!query) return true;
                return [channel.title, channel.uploader, channel.channel_id]
                  .filter(Boolean)
                  .some((value) => value?.toLowerCase().includes(query));
              }).map((channel) => {
                const databaseId = channel.database_id as number;
                return (
                  <FormControlLabel
                    key={databaseId}
                    control={<Checkbox
                      checked={selectedChannelIds.includes(databaseId)}
                      onChange={(event) => setSelectedChannelIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, databaseId])].sort((a, b) => a - b)
                          : current.filter((id) => id !== databaseId)
                      )}
                    />}
                    label={channel.title || channel.uploader || channel.channel_id || `Channel ${databaseId}`}
                  />
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditKey(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveExternalAccess} disabled={savingPolicy}>
            {savingPolicy ? 'Saving…' : 'Save External Access'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Key Created Dialog with Bookmarklet */}
      <Dialog
        open={createdKeyDialogOpen}
        onClose={() => setCreatedKeyDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>✓ API Key Created</DialogTitle>
        <DialogContent>
          <Alert severity="warning" className="mb-6">
            Save this key now - it will not be shown again!
          </Alert>

          <Typography variant="subtitle2" gutterBottom>
            Your API Key
          </Typography>
          <Paper
            className="p-4 mb-6 flex items-center justify-between bg-muted/50 font-mono break-all"
          >
            <code>{createdKey?.key}</code>
            <IconButton
              onClick={() => copyToClipboard(createdKey?.key || '', 'API key')}
              size="small"
            >
              <ContentCopyIcon size={16} />
            </IconButton>
          </Paper>

          {createdKeyRole === 'legacy_download' ? <><Typography variant="subtitle2" gutterBottom>
            📚 Add to Bookmarks
          </Typography>
          <Typography variant="body2" color="secondary" className="mb-2">
            Drag this button to your bookmarks bar:
          </Typography>
          <Box className="mb-4">
            <a
              href={createdKey ? generateBookmarklet(createdKey.key) : '#'}
              onClick={(e) => e.preventDefault()}
              draggable="true"
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
                borderRadius: 'var(--radius-input)',
                textDecoration: 'none',
                fontWeight: 500,
                cursor: 'grab',
              }}
            >
              📥 Send to Youtarr
            </a>
          </Box>

          <Typography variant="body2" color="secondary" className="mb-2">
            Or copy the bookmarklet code:
          </Typography>
          <Paper
            className="p-4 mb-6 flex items-center justify-between bg-muted/50 max-h-[100px] overflow-auto"
          >
            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
              {createdKey ? generateBookmarklet(createdKey.key) : ''}
            </code>
            <IconButton
              onClick={() =>
                copyToClipboard(
                  createdKey ? generateBookmarklet(createdKey.key) : '',
                  'Bookmarklet'
                )
              }
              size="small"
            >
              <ContentCopyIcon size={16} />
            </IconButton>
          </Paper>

          <Typography variant="subtitle2" gutterBottom>
            📱 Mobile / Shortcuts
          </Typography>
          <Typography variant="body2" color="secondary" className="mb-2">
            Use this URL in Apple Shortcuts, Tasker, or other tools:
          </Typography>
          <Paper className="p-4 bg-muted/50">
            <Typography variant="body2" style={{ fontFamily: 'monospace' }} className="mb-2">
              <strong>URL:</strong> {locationUtils.getOrigin()}/api/videos/download
            </Typography>
            <Typography variant="body2" style={{ fontFamily: 'monospace' }} className="mb-2">
              <strong>Method:</strong> POST
            </Typography>
            <Typography variant="body2" style={{ fontFamily: 'monospace' }} className="mb-2">
              <strong>Header:</strong> x-api-key: {createdKey?.key?.substring(0, 8)}...
            </Typography>
            <Typography variant="body2" style={{ fontFamily: 'monospace' }}>
              <strong>Body:</strong> {`{ "url": "<youtube-url>" }`}
            </Typography>
          </Paper>
          </> : (
            <Paper className="p-4 bg-muted/50">
              <Typography variant="body2" className="mb-2">
                Use this key only with <strong>{locationUtils.getOrigin()}/external-api/v1</strong>.
              </Typography>
              <Typography variant="body2" color="secondary">
                Add channel grants from this key&apos;s edit action before connecting External Client.
              </Typography>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedKeyDialogOpen(false)} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmDialog.open}
        onClose={() => setDeleteConfirmDialog({ open: false, keyId: null, keyName: '' })}
      >
        <DialogTitle>Revoke API Key?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to revoke the API key <strong>"{deleteConfirmDialog.keyName}"</strong>?
          </Typography>
          <Typography variant="body2" color="secondary" className="mt-2">
            Any integration using this key will stop working immediately. Its audit history is retained.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmDialog({ open: false, keyId: null, keyName: '' })}>
            Cancel
          </Button>
          <Button onClick={handleDeleteKey} color="error" variant="contained">
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </ConfigurationAccordion>
  );
};

export default ApiKeysSection;
