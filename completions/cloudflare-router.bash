# bash completion for cloudflare-router

_cloudflare_router() {
  local cur prev opts
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  # Main commands
  local commands="account:add account:remove account:list zone:discover zone:add zone:remove add remove list generate deploy status dashboard help"

  # Options for each command
  case "$prev" in
    account:add)
      COMPREPLY=( $(compgen -W "--name --email --api-key" -- "$cur") )
      return 0
      ;;
    account:remove)
      COMPREPLY=( $(compgen -W "--id" -- "$cur") )
      return 0
      ;;
    zone:discover)
      COMPREPLY=( $(compgen -W "--account" -- "$cur") )
      return 0
      ;;
    zone:add)
      COMPREPLY=( $(compgen -W "--account --zone-id --domain --tunnel-id --credentials" -- "$cur") )
      return 0
      ;;
    zone:remove)
      COMPREPLY=( $(compgen -W "--account --zone-id" -- "$cur") )
      return 0
      ;;
    add)
      COMPREPLY=( $(compgen -W "--account --zone --subdomain --port --description -d" -- "$cur") )
      return 0
      ;;
    remove)
      COMPREPLY=( $(compgen -W "--account --zone --subdomain" -- "$cur") )
      return 0
      ;;
    dashboard)
      COMPREPLY=( $(compgen -W "--port -p" -- "$cur") )
      return 0
      ;;
  esac

  # If no command yet, show commands
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi
}

complete -F _cloudflare_router cloudflare-router
